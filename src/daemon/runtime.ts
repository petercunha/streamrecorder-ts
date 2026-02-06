import fs from "node:fs";
import path from "node:path";
import { RUNTIME_FILE_NAME } from "../shared/constants.js";
import type { DaemonRuntime } from "../shared/types.js";
import { ensureDirSync, readJsonFileSync, writeJsonFileSync } from "../utils/fs.js";
import { isPidRunning } from "../utils/process.js";

export function runtimeFilePath(configDir: string): string {
  return path.join(configDir, RUNTIME_FILE_NAME);
}

export function readRuntime(configDir: string): DaemonRuntime | null {
  const runtime = readJsonFileSync<DaemonRuntime>(runtimeFilePath(configDir));
  if (!runtime) {
    return null;
  }
  if (!isPidRunning(runtime.pid)) {
    clearRuntime(configDir);
    return null;
  }
  return runtime;
}

export function writeRuntime(configDir: string, runtime: DaemonRuntime): void {
  ensureDirSync(configDir);
  writeJsonFileSync(runtimeFilePath(configDir), runtime);
}

export function clearRuntime(configDir: string): void {
  const filePath = runtimeFilePath(configDir);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}
