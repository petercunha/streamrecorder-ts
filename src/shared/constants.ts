import os from "node:os";
import path from "node:path";
import type { AppConfig } from "./types.js";

export const APP_NAME = "streamrecorder";
export const DB_FILE_NAME = "state.db";
export const RUNTIME_FILE_NAME = "runtime.json";
export const BOOTSTRAP_FILE_NAME = "bootstrap.json";

export const DEFAULT_CONFIG_DIR = path.join(os.homedir(), ".config", APP_NAME);
export const DEFAULT_RECORDINGS_DIR = path.join(os.homedir(), "Videos", "StreamRecorder");

export const DEFAULT_CONFIG: AppConfig = {
  recordingsDir: DEFAULT_RECORDINGS_DIR,
  defaultQuality: "best",
  pollIntervalSec: 60,
  probeTimeoutSec: 20,
  streamlinkPath: "streamlink",
  logLevel: "info",
  maxConcurrentRecordings: 0,
  filenameTemplate: "{slug}_{startedAt}_{quality}.ts"
};

export const DAEMON_HOST = "127.0.0.1";
export const HTTP_API_PREFIX = "/v1";
