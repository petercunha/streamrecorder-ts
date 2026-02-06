import pino from "pino";
import type { LogLevel } from "./types.js";

export function createLogger(level: LogLevel) {
  return pino({
    level,
    timestamp: pino.stdTimeFunctions.isoTime
  });
}
