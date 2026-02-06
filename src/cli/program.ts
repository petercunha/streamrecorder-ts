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
  const daemonRunConfigDir = tryExtractDaemonRunConfigDir(argv);
  if (daemonRunConfigDir !== null) {
    await runDaemonProcess(daemonRunConfigDir);
    return;
  }

  const program = new Command();
  program
    .name("sr")
    .description("Record livestreams automatically with Streamlink when channels go live.")
    .option("--config-dir <path>", "Use a specific config directory for this command")
    .showHelpAfterError("(run 'sr help' for command usage)")
    .addHelpText(
      "after",
      `
Examples:
  sr add ninja
  sr add https://www.youtube.com/@example best
  sr daemon start
  sr status --json
  sr config set pollIntervalSec 60
`
    );

  program
    .command("add")
    .description("Add a stream target to monitor and record")
    .argument("<target>", "Stream URL or streamer name (defaults to twitch)")
    .argument("[quality]", "Preferred quality (default from config: defaultQuality)")
    .addHelpText(
      "after",
      `
Examples:
  sr add ninja
  sr add shroud 720p60
  sr add https://kick.com/somechannel best
`
    )
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
    .description("Remove a configured target by id, URL, input name, or display name")
    .argument("<target>", "Target id/url/name")
    .addHelpText(
      "after",
      `
Examples:
  sr rm 3
  sr rm ninja
  sr del https://twitch.tv/ninja
`
    )
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
    .description("List configured targets and their current recording state")
    .option("--json", "Output JSON")
    .action((options: { json?: boolean }) => {
      handleTargetList(program.opts<GlobalOptions>(), options);
    });

  program
    .command("status")
    .description("Alias of ls/list")
    .option("--json", "Output JSON")
    .action((options: { json?: boolean }) => {
      handleTargetList(program.opts<GlobalOptions>(), options);
    });

  program
    .command("edit")
    .description("Update quality, enabled state, name, or URL for an existing target")
    .argument("<target>", "Target id/url/name")
    .option("--quality <quality>", "Requested quality")
    .option("--enabled <bool>", "Enable or disable target")
    .option("--name <displayName>", "Display name")
    .option("--url <url>", "Stream URL or streamer name")
    .addHelpText(
      "after",
      `
Examples:
  sr edit ninja --quality 720p60
  sr edit 2 --enabled false
  sr edit ninja --name "Ninja (Main)"
`
    )
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
    .description("Show aggregate stats for targets, sessions, and daemon state")
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

  const config = program
    .command("config")
    .description("Read and update application configuration")
    .addHelpText(
      "after",
      `
Examples:
  sr config list
  sr config get defaultQuality
  sr config set recordingsDir ~/Videos/StreamRecorder
  sr config set configDir /srv/streamrecorder
`
    );

  config.command("list").description("List all config keys and effective values").action(() => {
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
    .description("Get a single config value")
    .argument("<key>", "Config key (for example: defaultQuality, pollIntervalSec, configDir)")
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
    .description("Set a config value")
    .argument("<key>", "Config key to set")
    .argument("<value>", "New value")
    .addHelpText(
      "after",
      `
Examples:
  sr config set defaultQuality 720p60
  sr config set pollIntervalSec 45
  sr config set streamlinkPath /usr/local/bin/streamlink
`
    )
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

  const daemon = program
    .command("daemon")
    .description("Manage the background daemon process and autostart integration")
    .addHelpText(
      "after",
      `
Examples:
  sr daemon start
  sr daemon status
  sr daemon enable
`
    );

  daemon.command("status").description("Show daemon runtime status and autostart state").action(async () => {
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

  daemon.command("start").description("Start the daemon in the background").action(async () => {
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

  daemon.command("stop").description("Stop the running daemon").action(async () => {
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

  daemon.command("enable").description("Enable daemon autostart for the current user").action(() => {
    const context = createContext(program.opts<GlobalOptions>());
    try {
      const details = enableAutostart(context.configDir);
      console.log(details);
    } finally {
      context.close();
    }
  });

  daemon.command("disable").description("Disable daemon autostart for the current user").action(() => {
    const context = createContext(program.opts<GlobalOptions>());
    try {
      const details = disableAutostart();
      console.log(details);
    } finally {
      context.close();
    }
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

function tryExtractDaemonRunConfigDir(argv: string[]): string | null {
  const args = argv.slice(2);
  let configDir: string | undefined;
  let commandName: string | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];

    if (token === "--config-dir") {
      const next = args[i + 1];
      if (next && !next.startsWith("-")) {
        configDir = next;
        i += 1;
      }
      continue;
    }

    if (token.startsWith("--config-dir=")) {
      configDir = token.slice("--config-dir=".length);
      continue;
    }

    if (token.startsWith("-")) {
      continue;
    }

    commandName = token;
    break;
  }

  if (commandName !== "daemon-run") {
    return null;
  }

  return configDir ?? null;
}
