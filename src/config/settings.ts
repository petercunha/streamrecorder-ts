import { DEFAULT_CONFIG } from "../shared/constants.js";
import type { AppConfig, ConfigKey } from "../shared/types.js";
import { ValidationError } from "../shared/errors.js";
import { resolveUserPath } from "../utils/path.js";

export const CONFIG_KEYS: (keyof AppConfig)[] = [
  "recordingsDir",
  "defaultQuality",
  "pollIntervalSec",
  "probeTimeoutSec",
  "streamlinkPath",
  "postprocessToMp4",
  "logLevel",
  "maxConcurrentRecordings",
  "filenameTemplate"
];

export function parseConfigValue(key: keyof AppConfig, value: string): AppConfig[keyof AppConfig] {
  switch (key) {
    case "recordingsDir": {
      const resolved = resolveUserPath(value);
      if (!resolved) {
        throw new ValidationError("recordingsDir cannot be empty");
      }
      return resolved;
    }
    case "defaultQuality": {
      if (!value.trim()) {
        throw new ValidationError("defaultQuality cannot be empty");
      }
      return value.trim();
    }
    case "pollIntervalSec": {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isInteger(parsed) || parsed < 15) {
        throw new ValidationError("pollIntervalSec must be an integer >= 15");
      }
      return parsed;
    }
    case "probeTimeoutSec": {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isInteger(parsed) || parsed < 5) {
        throw new ValidationError("probeTimeoutSec must be an integer >= 5");
      }
      return parsed;
    }
    case "streamlinkPath": {
      if (!value.trim()) {
        throw new ValidationError("streamlinkPath cannot be empty");
      }
      return value.trim();
    }
    case "postprocessToMp4": {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes", "on"].includes(normalized)) {
        return true;
      }
      if (["false", "0", "no", "off"].includes(normalized)) {
        return false;
      }
      throw new ValidationError("postprocessToMp4 must be a boolean (true/false)");
    }
    case "logLevel": {
      if (!["debug", "info", "warn", "error"].includes(value)) {
        throw new ValidationError("logLevel must be one of: debug, info, warn, error");
      }
      return value as AppConfig["logLevel"];
    }
    case "maxConcurrentRecordings": {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new ValidationError("maxConcurrentRecordings must be an integer >= 0");
      }
      return parsed;
    }
    case "filenameTemplate": {
      if (!value.trim()) {
        throw new ValidationError("filenameTemplate cannot be empty");
      }
      return value.trim();
    }
    default: {
      const _exhaustive: never = key;
      return _exhaustive;
    }
  }
}

export function stringifyConfigValue(key: keyof AppConfig, value: AppConfig[keyof AppConfig]): string {
  switch (key) {
    case "pollIntervalSec":
    case "probeTimeoutSec":
    case "maxConcurrentRecordings":
      return String(value);
    default:
      return String(value);
  }
}

export function configKeyFromInput(key: string): ConfigKey {
  if (key === "configDir") {
    return key;
  }

  if (CONFIG_KEYS.includes(key as keyof AppConfig)) {
    return key as ConfigKey;
  }

  throw new ValidationError(`Unknown config key: ${key}`);
}

export function mergeConfig(dbValues: Partial<Record<keyof AppConfig, string>>): AppConfig {
  return {
    recordingsDir:
      dbValues.recordingsDir !== undefined
        ? (parseConfigValue("recordingsDir", dbValues.recordingsDir) as AppConfig["recordingsDir"])
        : DEFAULT_CONFIG.recordingsDir,
    defaultQuality:
      dbValues.defaultQuality !== undefined
        ? (parseConfigValue("defaultQuality", dbValues.defaultQuality) as AppConfig["defaultQuality"])
        : DEFAULT_CONFIG.defaultQuality,
    pollIntervalSec:
      dbValues.pollIntervalSec !== undefined
        ? (parseConfigValue("pollIntervalSec", dbValues.pollIntervalSec) as AppConfig["pollIntervalSec"])
        : DEFAULT_CONFIG.pollIntervalSec,
    probeTimeoutSec:
      dbValues.probeTimeoutSec !== undefined
        ? (parseConfigValue("probeTimeoutSec", dbValues.probeTimeoutSec) as AppConfig["probeTimeoutSec"])
        : DEFAULT_CONFIG.probeTimeoutSec,
    streamlinkPath:
      dbValues.streamlinkPath !== undefined
        ? (parseConfigValue("streamlinkPath", dbValues.streamlinkPath) as AppConfig["streamlinkPath"])
        : DEFAULT_CONFIG.streamlinkPath,
    postprocessToMp4:
      dbValues.postprocessToMp4 !== undefined
        ? (parseConfigValue("postprocessToMp4", dbValues.postprocessToMp4) as AppConfig["postprocessToMp4"])
        : DEFAULT_CONFIG.postprocessToMp4,
    logLevel:
      dbValues.logLevel !== undefined
        ? (parseConfigValue("logLevel", dbValues.logLevel) as AppConfig["logLevel"])
        : DEFAULT_CONFIG.logLevel,
    maxConcurrentRecordings:
      dbValues.maxConcurrentRecordings !== undefined
        ? (parseConfigValue("maxConcurrentRecordings", dbValues.maxConcurrentRecordings) as AppConfig["maxConcurrentRecordings"])
        : DEFAULT_CONFIG.maxConcurrentRecordings,
    filenameTemplate:
      dbValues.filenameTemplate !== undefined
        ? (parseConfigValue("filenameTemplate", dbValues.filenameTemplate) as AppConfig["filenameTemplate"])
        : DEFAULT_CONFIG.filenameTemplate
  };
}
