import path from "node:path";
import { DbClient } from "../db/client.js";
import { resolveConfigDir } from "../config/bootstrap.js";
import { mergeConfig, parseConfigValue, stringifyConfigValue } from "../config/settings.js";
import { createLogger } from "../shared/logger.js";
import type { AppConfig } from "../shared/types.js";

export interface AppContext {
  configDir: string;
  db: DbClient;
  config: AppConfig;
  close(): void;
}

export function createAppContext(input: { configDirOverride?: string }): AppContext {
  const configDir = path.resolve(resolveConfigDir(input.configDirOverride));
  const db = new DbClient(configDir);
  const config = mergeConfig(db.listConfigRaw());
  const logger = createLogger(config.logLevel);

  logger.debug({ configDir }, "context created");

  return {
    configDir,
    db,
    config,
    close() {
      db.close();
    }
  };
}

export function setAppConfigValue<K extends keyof AppConfig>(
  context: AppContext,
  key: K,
  rawValue: string
): AppConfig[K] {
  const parsed = parseConfigValue(key, rawValue) as AppConfig[K];
  context.db.setConfigValueRaw(key, stringifyConfigValue(key, parsed));
  return parsed;
}
