export type LogLevel = "debug" | "info" | "warn" | "error";

export interface AppConfig {
  recordingsDir: string;
  defaultQuality: string;
  pollIntervalSec: number;
  probeTimeoutSec: number;
  streamlinkPath: string;
  logLevel: LogLevel;
  maxConcurrentRecordings: number;
  filenameTemplate: string;
}

export type ConfigKey = keyof AppConfig | "configDir";

export interface StreamTarget {
  id: number;
  input: string;
  normalizedUrl: string;
  platform: string;
  displayName: string;
  requestedQuality: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NewStreamTarget {
  input: string;
  normalizedUrl: string;
  platform: string;
  displayName: string;
  requestedQuality: string;
}

export interface UpdateStreamTarget {
  normalizedUrl?: string;
  platform?: string;
  displayName?: string;
  requestedQuality?: string;
  enabled?: boolean;
  input?: string;
}

export interface RecordingSession {
  id: number;
  targetId: number;
  pid: number;
  selectedQuality: string;
  outputPath: string;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  bytesWritten: number | null;
}

export interface ProbeResult {
  isLive: boolean;
  availableQualities: string[];
  rawJson?: unknown;
  error?: string;
}

export interface DaemonRuntime {
  pid: number;
  port: number;
  token: string;
  startedAt: string;
  configDir: string;
}

export interface DaemonStatus {
  running: boolean;
  pid?: number;
  port?: number;
  uptimeSec?: number;
  activeRecordings: number;
  nextPollAt?: string;
}

export interface QualityCandidate {
  label: string;
  height: number;
  fps: number;
}

export interface TargetStats {
  total: number;
  enabled: number;
}

export interface SessionStats {
  total: number;
  active: number;
  finished: number;
  totalDurationSec: number;
}
