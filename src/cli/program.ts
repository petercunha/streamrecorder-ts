import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { Command } from "commander";
import { createAppContext, setAppConfigValue } from "./context.js";
import { normalizeTargetInput } from "../core/target.js";
import { NotFoundError, ValidationError } from "../shared/errors.js";
import { CONFIG_KEYS, configKeyFromInput, parseConfigValue } from "../config/settings.js";
import type { StreamTarget } from "../shared/types.js";
import { readRuntime } from "../daemon/runtime.js";
import { DaemonApiClient } from "../daemon/ipcClient.js";
import { persistConfigDir, migrateDbIfNeeded } from "../config/bootstrap.js";
import { DB_FILE_NAME, DEFAULT_CONFIG_DIR } from "../shared/constants.js";
import { enableAutostart, disableAutostart, autostartStatus } from "../platform/autostart.js";
import { createLogger } from "../shared/logger.js";
import { StreamlinkAdapter } from "../streamlink/adapter.js";
import { RecorderDaemon } from "../daemon/daemon.js";
import { resolveUserPath } from "../utils/path.js";
import { isPidRunning } from "../utils/process.js";

interface GlobalOptions {
  configDir?: string;
}

export async function runCli(argv: string[]): Promise<void> {
  const program = new Command();
  program
    .name("sr")
    .description("Stream recorder daemon powered by Streamlink")
    .option("--config-dir <path>", "Override config directory for this command");

  program
    .command("add")
    .argument("<target>", "Stream URL or streamer name (defaults to twitch)")
    .argument("[quality]", "Requested quality")
    .action(async (target, quality) => {
      const context = createContext(program.opts<GlobalOptions>());
      try {
        const normalized = normalizeTargetInput(target);
        const chosenQuality = quality ?? context.config.defaultQuality;
        const added = context.db.addTarget({
          input: normalized.input,
          normalizedUrl: normalized.normalizedUrl,
          platform: normalized.platform,
          displayName: normalized.displayName,
          requestedQuality: chosenQuality
        });

        console.log(`Added target ${added.id}: ${added.displayName} (${added.normalizedUrl}) quality=${added.requestedQuality}`);
        await reloadDaemonIfRunning(context.configDir);
      } finally {
        context.close();
      }
    });

  program
    .command("rm")
    .alias("del")
    .argument("<target>", "Target id/url/name")
    .action(async (target) => {
      const context = createContext(program.opts<GlobalOptions>());
      try {
        const removed = context.db.removeTarget(target);
        console.log(`Removed target ${removed.id}: ${removed.displayName}`);
        await reloadDaemonIfRunning(context.configDir);
      } finally {
        context.close();
      }
    });

  program
    .command("ls")
    .alias("list")
    .option("--json", "Output JSON")
    .action((options: { json?: boolean }) => {
      handleTargetList(program.opts<GlobalOptions>(), options);
    });

  program
    .command("status")
    .description("Alias of ls/list with recording status")
    .option("--json", "Output JSON")
    .action((options: { json?: boolean }) => {
      handleTargetList(program.opts<GlobalOptions>(), options);
    });

  program
    .command("edit")
    .argument("<target>", "Target id/url/name")
    .option("--quality <quality>", "Requested quality")
    .option("--enabled <bool>", "Enable or disable target")
    .option("--name <displayName>", "Display name")
    .option("--url <url>", "Stream URL or streamer name")
    .action(async (target, options: { quality?: string; enabled?: string; name?: string; url?: string }) => {
      const context = createContext(program.opts<GlobalOptions>());
      try {
        const patch: {
          requestedQuality?: string;
          enabled?: boolean;
          displayName?: string;
          normalizedUrl?: string;
          platform?: string;
          input?: string;
        } = {};

        if (options.quality) {
          patch.requestedQuality = options.quality;
        }

        if (options.enabled !== undefined) {
          patch.enabled = parseBool(options.enabled);
        }

        if (options.name) {
          patch.displayName = options.name;
        }

        if (options.url) {
          const normalized = normalizeTargetInput(options.url);
          patch.input = normalized.input;
          patch.normalizedUrl = normalized.normalizedUrl;
          patch.platform = normalized.platform;
          patch.displayName = patch.displayName ?? normalized.displayName;
        }

        const updated = context.db.updateTarget(target, patch);
        console.log(`Updated target ${updated.id}: ${updated.displayName}`);
        await reloadDaemonIfRunning(context.configDir);
      } finally {
        context.close();
      }
    });

  program
    .command("stats")
    .option("--json", "Output JSON")
    .action(async (options: { json?: boolean }) => {
      const context = createContext(program.opts<GlobalOptions>());
      try {
        const targetStats = context.db.getTargetStats();
        const sessionStats = context.db.getSessionStats();
        const runtime = readRuntime(context.configDir);

        const payload = {
          targets: targetStats,
          sessions: sessionStats,
          daemon: {
            running: runtime !== null,
            pid: runtime?.pid,
            startedAt: runtime?.startedAt
          }
        };

        if (options.json) {
          console.log(JSON.stringify(payload, null, 2));
          return;
        }

        console.log(`Targets: total=${targetStats.total} enabled=${targetStats.enabled}`);
        console.log(
          `Sessions: total=${sessionStats.total} active=${sessionStats.active} finished=${sessionStats.finished} durationSec=${sessionStats.totalDurationSec}`
        );
        console.log(`Daemon: running=${payload.daemon.running}${payload.daemon.pid ? ` pid=${payload.daemon.pid}` : ""}`);
      } finally {
        context.close();
      }
    });

  const config = program.command("config").description("Read and update configuration");

  config.command("list").action(() => {
    const context = createContext(program.opts<GlobalOptions>());
    try {
      const values = context.db.listConfigRaw();
      console.log(`configDir=${context.configDir}`);
      for (const key of CONFIG_KEYS) {
        console.log(`${key}=${values[key] ?? String(context.config[key])}`);
      }
    } finally {
      context.close();
    }
  });

  config
    .command("get")
    .argument("<key>")
    .action((keyInput: string) => {
      const context = createContext(program.opts<GlobalOptions>());
      try {
        const key = configKeyFromInput(keyInput);
        if (key === "configDir") {
          console.log(context.configDir);
          return;
        }

        console.log(context.db.getConfigValueRaw(key));
      } finally {
        context.close();
      }
    });

  config
    .command("set")
    .argument("<key>")
    .argument("<value>")
    .action(async (keyInput: string, value: string) => {
      const context = createContext(program.opts<GlobalOptions>());
      try {
        const key = configKeyFromInput(keyInput);

        if (key === "configDir") {
          const nextDir = resolveUserPath(value);
          if (nextDir === context.configDir) {
            console.log(`configDir already set to ${nextDir}`);
            return;
          }

          const currentDbPath = path.join(context.configDir, DB_FILE_NAME);
          const nextDbPath = path.join(nextDir, DB_FILE_NAME);
          fs.mkdirSync(nextDir, { recursive: true });
          migrateDbIfNeeded(currentDbPath, nextDbPath);
          persistConfigDir(nextDir);
          console.log(`configDir set to ${nextDir}`);
          return;
        }

        parseConfigValue(key, value);
        const updated = setAppConfigValue(context, key, value);
        console.log(`Updated ${key}=${updated}`);
        await reloadDaemonIfRunning(context.configDir);
      } finally {
        context.close();
      }
    });

  const daemon = program.command("daemon").description("Control the stream recorder daemon");

  daemon.command("status").action(async () => {
    const context = createContext(program.opts<GlobalOptions>());
    try {
      const runtime = readRuntime(context.configDir);
      const startup = autostartStatus();
      if (!runtime) {
        console.log(`Daemon: stopped (autostart=${startup.enabled ? "enabled" : "disabled"}, ${startup.details})`);
        return;
      }

      try {
        const client = new DaemonApiClient(runtime);
        const status = await client.status();
        console.log(
          `Daemon: running pid=${status.pid} port=${status.port} activeRecordings=${status.activeRecordings} nextPollAt=${status.nextPollAt ?? "n/a"}`
        );
        console.log(`Autostart: ${startup.enabled ? "enabled" : "disabled"} (${startup.details})`);
      } catch {
        console.log(`Daemon: running pid=${runtime.pid} (status endpoint unavailable)`);
      }
    } finally {
      context.close();
    }
  });

  daemon.command("start").action(async () => {
    const context = createContext(program.opts<GlobalOptions>());
    try {
      const runtime = readRuntime(context.configDir);
      if (runtime) {
        console.log(`Daemon already running (pid ${runtime.pid})`);
        return;
      }

      const entry = process.argv[1];
      if (!entry) {
        throw new Error("Unable to determine CLI entrypoint");
      }

      const child = spawn(process.execPath, [entry, "--config-dir", context.configDir, "daemon-run"], {
        detached: true,
        stdio: "ignore"
      });
      child.unref();

      const started = await waitForDaemonRuntime(context.configDir, 4000);
      if (!started) {
        throw new Error("Daemon did not start in time");
      }

      console.log("Daemon started");
    } finally {
      context.close();
    }
  });

  daemon.command("stop").action(async () => {
    const context = createContext(program.opts<GlobalOptions>());
    try {
      const runtime = readRuntime(context.configDir);
      if (!runtime) {
        console.log("Daemon is not running");
        return;
      }

      const client = new DaemonApiClient(runtime);
      try {
        await client.shutdown();
        console.log("Daemon stop requested");
      } catch {
        try {
          process.kill(runtime.pid, "SIGTERM");
          console.log(`Daemon signaled directly (pid ${runtime.pid})`);
        } catch {
          console.log("Daemon appears to have already stopped");
        }
      }
    } finally {
      context.close();
    }
  });

  daemon.command("enable").action(() => {
    const context = createContext(program.opts<GlobalOptions>());
    try {
      const details = enableAutostart(context.configDir);
      console.log(details);
    } finally {
      context.close();
    }
  });

  daemon.command("disable").action(() => {
    const context = createContext(program.opts<GlobalOptions>());
    try {
      const details = disableAutostart();
      console.log(details);
    } finally {
      context.close();
    }
  });

  program
    .command("daemon-run")
    .description("Internal daemon process entrypoint")
    .action(async () => {
      const options = program.opts<GlobalOptions>();
      await runDaemonProcess(options.configDir);
    });

  await program.parseAsync(argv);
}

async function runDaemonProcess(configDirOverride?: string): Promise<void> {
  const context = createAppContext({ configDirOverride });
  const logger = createLogger(context.config.logLevel);
  const streamlink = new StreamlinkAdapter({
    binaryPath: context.config.streamlinkPath,
    probeTimeoutSec: context.config.probeTimeoutSec
  });

  const daemon = new RecorderDaemon({
    configDir: context.configDir,
    config: context.config,
    db: context.db,
    logger,
    streamlink
  });

  const shutdown = async () => {
    await daemon.stop();
    context.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });

  process.on("SIGTERM", () => {
    void shutdown();
  });

  try {
    await daemon.start();
  } catch (error) {
    context.close();
    throw error;
  }

  await new Promise<void>(() => {
    // daemon keeps process alive via interval + HTTP server
  });
}

function createContext(options: GlobalOptions) {
  return createAppContext({
    configDirOverride: options.configDir
  });
}

function parseBool(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }
  throw new ValidationError(`Invalid boolean value: ${value}`);
}

function handleTargetList(globalOptions: GlobalOptions, options: { json?: boolean }): void {
  const context = createContext(globalOptions);
  try {
    const targets = context.db.listTargets();
    const recordingTargetIds = getRecordingTargetIds(context.db.listActiveSessions());
    const rows = targets.map((target) => ({
      ...target,
      isRecording: recordingTargetIds.has(target.id)
    }));

    if (options.json) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }

    if (targets.length === 0) {
      console.log("No targets configured");
      return;
    }

    printTargets(targets, recordingTargetIds);
  } finally {
    context.close();
  }
}

function printTargets(targets: StreamTarget[], recordingTargetIds: Set<number>): void {
  const rows = targets.map((target) => ({
    id: target.id,
    name: target.displayName,
    enabled: target.enabled,
    recording: recordingTargetIds.has(target.id),
    quality: target.requestedQuality,
    url: target.normalizedUrl
  }));
  console.table(rows);
}

function getRecordingTargetIds(sessions: Array<{ targetId: number; pid: number }>): Set<number> {
  const ids = new Set<number>();
  for (const session of sessions) {
    if (isPidRunning(session.pid)) {
      ids.add(session.targetId);
    }
  }
  return ids;
}

async function reloadDaemonIfRunning(configDir: string): Promise<void> {
  const runtime = readRuntime(configDir);
  if (!runtime) {
    return;
  }

  try {
    const client = new DaemonApiClient(runtime);
    await client.reload();
  } catch {
    // daemon might be restarting; ignore
  }
}

async function waitForDaemonRuntime(configDir: string, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const runtime = readRuntime(configDir);
    if (runtime) {
      return true;
    }
    await sleep(150);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function handleCliError(error: unknown): number {
  if (error instanceof NotFoundError || error instanceof ValidationError) {
    console.error(error.message);
    return 2;
  }

  if (error instanceof Error) {
    console.error(error.message);
    return 1;
  }

  console.error("Unknown error");
  return 1;
}

export function printHelpHint(): void {
  console.error(`Run 'sr help' for usage. Default config dir: ${DEFAULT_CONFIG_DIR}`);
}
