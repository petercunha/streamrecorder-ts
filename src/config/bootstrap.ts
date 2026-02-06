import fs from "node:fs";
import path from "node:path";
import { BOOTSTRAP_FILE_NAME, DEFAULT_CONFIG_DIR } from "../shared/constants.js";
import { ensureDirSync, readJsonFileSync, writeJsonFileSync } from "../utils/fs.js";
import { resolveUserPath } from "../utils/path.js";

interface BootstrapFile {
  configDir?: string;
}

export function getDefaultRootDir(): string {
  return DEFAULT_CONFIG_DIR;
}

export function getBootstrapPath(): string {
  return path.join(getDefaultRootDir(), BOOTSTRAP_FILE_NAME);
}

export function resolveConfigDir(cliOverride?: string): string {
  if (cliOverride) {
    return resolveUserPath(cliOverride);
  }

  if (process.env.SR_CONFIG_DIR) {
    return resolveUserPath(process.env.SR_CONFIG_DIR);
  }

  const bootstrap = readJsonFileSync<BootstrapFile>(getBootstrapPath());
  if (bootstrap?.configDir) {
    return resolveUserPath(bootstrap.configDir);
  }

  return getDefaultRootDir();
}

export function persistConfigDir(newConfigDir: string): void {
  const bootstrapPath = getBootstrapPath();
  ensureDirSync(path.dirname(bootstrapPath));
  writeJsonFileSync(bootstrapPath, { configDir: resolveUserPath(newConfigDir) });
}

export function migrateDbIfNeeded(currentDbPath: string, nextDbPath: string): void {
  if (!fs.existsSync(currentDbPath) || fs.existsSync(nextDbPath)) {
    return;
  }

  ensureDirSync(path.dirname(nextDbPath));
  fs.copyFileSync(currentDbPath, nextDbPath);
}
