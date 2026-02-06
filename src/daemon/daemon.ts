import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { ChildProcess } from "node:child_process";
import type pino from "pino";
import { DbClient } from "../db/client.js";
import type { AppConfig, DaemonRuntime, DaemonStatus, StreamTarget } from "../shared/types.js";
import { DAEMON_HOST, HTTP_API_PREFIX } from "../shared/constants.js";
import { StreamlinkAdapter } from "../streamlink/adapter.js";
import { selectQuality } from "../core/quality.js";
import { buildRecordingPath } from "../core/filename.js";
import { ensureDirSync, fileExists } from "../utils/fs.js";
import { clearRuntime, writeRuntime } from "./runtime.js";
import { mergeConfig } from "../config/settings.js";

interface ActiveRecording {
  target: StreamTarget;
  child: ChildProcess;
  selectedQuality: string;
  outputPath: string;
  startedAt: string;
}

export interface RecorderDaemonInput {
  configDir: string;
  config: AppConfig;
  db: DbClient;
  logger: pino.Logger;
  streamlink: StreamlinkAdapter;
}

export class RecorderDaemon {
  private readonly activeRecordings = new Map<number, ActiveRecording>();
  private interval?: NodeJS.Timeout;
  private server?: http.Server;
  private readonly token = crypto.randomBytes(24).toString("hex");
  private nextPollAt?: Date;
  private isStopping = false;
  private pollInProgress = false;
  private readonly lockPath: string;
  private config: AppConfig;
  private streamlink: StreamlinkAdapter;

  constructor(private readonly input: RecorderDaemonInput) {
    this.lockPath = path.join(input.configDir, "daemon.lock");
    this.config = input.config;
    this.streamlink = input.streamlink;
  }

  async start(): Promise<void> {
    this.acquireLock();
    this.streamlink.assertAvailable();

    const server = http.createServer((req, res) => {
      void this.handleRequest(req, res).catch((error: unknown) => {
        this.input.logger.error({ err: error }, "daemon request handler failed");
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(`${JSON.stringify({ error: "Internal server error" })}\n`);
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, DAEMON_HOST, () => resolve());
    });

    this.server = server;
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind daemon HTTP server");
    }

    const runtime: DaemonRuntime = {
      pid: process.pid,
      port: address.port,
      token: this.token,
      startedAt: new Date().toISOString(),
      configDir: this.input.configDir
    };

    writeRuntime(this.input.configDir, runtime);
    this.input.logger.info({ port: address.port }, "daemon started");

    void this.pollOnce();
    this.resetPollInterval();
  }

  async stop(): Promise<void> {
    if (this.isStopping) {
      return;
    }
    this.isStopping = true;

    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }

    for (const recording of this.activeRecordings.values()) {
      try {
        recording.child.kill("SIGTERM");
      } catch {
        // ignore
      }
    }

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server?.close(() => resolve());
      });
      this.server = undefined;
    }

    clearRuntime(this.input.configDir);
    this.releaseLock();
    this.input.logger.info("daemon stopped");
  }

  private async pollOnce(): Promise<void> {
    if (this.pollInProgress || this.isStopping) {
      return;
    }

    this.pollInProgress = true;
    this.nextPollAt = new Date(Date.now() + this.config.pollIntervalSec * 1000);

    try {
      this.input.db.upsertDaemonMeta("lastPollAt", new Date().toISOString());
      const enabledTargets = this.input.db.listEnabledTargets();

      for (const target of enabledTargets) {
        try {
          if (this.activeRecordings.has(target.id)) {
            continue;
          }

          if (this.config.maxConcurrentRecordings > 0 && this.activeRecordings.size >= this.config.maxConcurrentRecordings) {
            break;
          }

          const probe = await this.streamlink.probe(target.normalizedUrl);
          if (!probe.isLive) {
            if (probe.error) {
              this.input.logger.debug({ targetId: target.id, error: probe.error }, "probe reported not live");
            }
            continue;
          }

          const selectedQuality = selectQuality(target.requestedQuality, probe.availableQualities);
          this.startRecording(target, selectedQuality);
        } catch (error) {
          this.input.logger.error({ err: error, targetId: target.id }, "target poll failed");
        }
      }
    } catch (error) {
      this.input.logger.error({ err: error }, "poll loop failed");
    } finally {
      this.pollInProgress = false;
    }
  }

  private startRecording(target: StreamTarget, selectedQuality: string): void {
    ensureDirSync(this.config.recordingsDir);
    const outputPath = this.resolveUniqueOutputPath(target, selectedQuality);

    const child = this.streamlink.spawnRecording(target.normalizedUrl, selectedQuality, outputPath);
    const startedAt = new Date().toISOString();
    const pid = child.pid ?? -1;

    if (pid <= 0) {
      this.input.logger.error({ targetId: target.id }, "failed to spawn recording process");
      return;
    }

    this.input.db.insertRecordingSession({
      targetId: target.id,
      pid,
      selectedQuality,
      outputPath,
      startedAt
    });

    const record: ActiveRecording = {
      target,
      child,
      selectedQuality,
      outputPath,
      startedAt
    };

    this.activeRecordings.set(target.id, record);
    this.input.logger.info(
      {
        targetId: target.id,
        pid,
        quality: selectedQuality,
        outputPath
      },
      "recording started"
    );

    child.on("exit", (code) => {
      this.activeRecordings.delete(target.id);
      this.input.db.finishRecordingSessionByPid(pid, {
        endedAt: new Date().toISOString(),
        exitCode: code
      });
      this.input.logger.info({ targetId: target.id, pid, code }, "recording exited");
    });

    child.on("error", (error) => {
      this.activeRecordings.delete(target.id);
      this.input.db.finishRecordingSessionByPid(pid, {
        endedAt: new Date().toISOString(),
        exitCode: 1
      });
      this.input.logger.error({ err: error, targetId: target.id }, "recording process errored");
    });
  }

  private resolveUniqueOutputPath(target: StreamTarget, selectedQuality: string): string {
    const basePath = buildRecordingPath({
      recordingsDir: this.config.recordingsDir,
      filenameTemplate: this.config.filenameTemplate,
      target,
      quality: selectedQuality
    });

    if (!fileExists(basePath)) {
      return basePath;
    }

    const ext = path.extname(basePath);
    const stem = basePath.slice(0, ext.length > 0 ? -ext.length : undefined);
    let suffix = 1;
    while (true) {
      const candidate = `${stem}_${suffix}${ext}`;
      if (!fileExists(candidate)) {
        return candidate;
      }
      suffix += 1;
    }
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.authorize(req)) {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    const method = req.method ?? "GET";
    const url = req.url ?? "/";

    if (method === "GET" && url === `${HTTP_API_PREFIX}/status`) {
      this.writeJson(res, this.currentStatus());
      return;
    }

    if (method === "POST" && url === `${HTTP_API_PREFIX}/reload`) {
      this.reloadConfig();
      this.writeJson(res, { ok: true });
      return;
    }

    if (method === "GET" && url === `${HTTP_API_PREFIX}/recordings`) {
      const list = Array.from(this.activeRecordings.values()).map((entry) => ({
        targetId: entry.target.id,
        target: entry.target.displayName,
        pid: entry.child.pid,
        selectedQuality: entry.selectedQuality,
        outputPath: entry.outputPath,
        startedAt: entry.startedAt
      }));
      this.writeJson(res, { recordings: list });
      return;
    }

    if (method === "POST" && url.startsWith(`${HTTP_API_PREFIX}/probe/`)) {
      const idRaw = url.slice(`${HTTP_API_PREFIX}/probe/`.length);
      const targetId = Number.parseInt(idRaw, 10);
      if (!Number.isInteger(targetId) || targetId <= 0) {
        this.writeJson(res, { error: "Invalid target id" }, 400);
        return;
      }

      const target = this.input.db.getTargetById(targetId);
      const probe = await this.streamlink.probe(target.normalizedUrl);
      if (probe.isLive && !this.activeRecordings.has(target.id)) {
        const selectedQuality = selectQuality(target.requestedQuality, probe.availableQualities);
        this.startRecording(target, selectedQuality);
      }
      this.writeJson(res, probe);
      return;
    }

    if (method === "POST" && url === `${HTTP_API_PREFIX}/shutdown`) {
      this.writeJson(res, { ok: true });
      setTimeout(() => {
        void this.stop().then(() => process.exit(0));
      }, 100);
      return;
    }

    this.writeJson(res, { error: "Not found" }, 404);
  }

  private authorize(req: IncomingMessage): boolean {
    const header = req.headers.authorization;
    if (!header) {
      return false;
    }
    return header === `Bearer ${this.token}`;
  }

  private currentStatus(): DaemonStatus {
    const startedAt = this.input.db.getDaemonMeta("lastStartedAt") ?? new Date().toISOString();
    const startedMs = Date.parse(startedAt);
    const uptimeSec = Number.isNaN(startedMs) ? 0 : Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
    const address = this.server?.address();
    const port = address && typeof address !== "string" ? address.port : undefined;

    return {
      running: true,
      pid: process.pid,
      port,
      uptimeSec,
      activeRecordings: this.activeRecordings.size,
      nextPollAt: this.nextPollAt?.toISOString()
    };
  }

  private writeJson(res: ServerResponse, body: unknown, statusCode = 200): void {
    res.statusCode = statusCode;
    res.setHeader("Content-Type", "application/json");
    res.end(`${JSON.stringify(body)}\n`);
  }

  private acquireLock(): void {
    ensureDirSync(this.input.configDir);
    if (fs.existsSync(this.lockPath)) {
      const raw = fs.readFileSync(this.lockPath, "utf8").trim();
      const pid = Number.parseInt(raw, 10);
      if (Number.isInteger(pid) && pid > 0 && isPidAlive(pid)) {
        throw new Error(`Daemon lock exists and process ${pid} is still running.`);
      }
    }

    fs.writeFileSync(this.lockPath, `${process.pid}\n`, "utf8");
    this.input.db.upsertDaemonMeta("lastStartedAt", new Date().toISOString());
  }

  private releaseLock(): void {
    if (fs.existsSync(this.lockPath)) {
      fs.unlinkSync(this.lockPath);
    }
  }

  private resetPollInterval(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
    this.interval = setInterval(() => {
      void this.pollOnce();
    }, this.config.pollIntervalSec * 1000);
  }

  private reloadConfig(): void {
    const prev = this.config;
    const next = mergeConfig(this.input.db.listConfigRaw());
    this.config = next;
    this.streamlink = new StreamlinkAdapter({
      binaryPath: next.streamlinkPath,
      probeTimeoutSec: next.probeTimeoutSec
    });
    this.streamlink.assertAvailable();
    this.input.logger.level = next.logLevel;
    if (prev.pollIntervalSec !== next.pollIntervalSec) {
      this.resetPollInterval();
    }
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
