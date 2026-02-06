import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DB_FILE_NAME, DEFAULT_CONFIG } from "../shared/constants.js";
import type {
  AppConfig,
  NewStreamTarget,
  RecordingSession,
  SessionStats,
  StreamTarget,
  TargetStats,
  UpdateStreamTarget
} from "../shared/types.js";
import { CONFIG_KEYS } from "../config/settings.js";
import { NotFoundError, ValidationError } from "../shared/errors.js";

interface TargetRow {
  id: number;
  input: string;
  normalized_url: string;
  platform: string;
  display_name: string;
  requested_quality: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

interface SessionRow {
  id: number;
  target_id: number;
  pid: number;
  selected_quality: string;
  output_path: string;
  started_at: string;
  ended_at: string | null;
  exit_code: number | null;
  bytes_written: number | null;
}

export class DbClient {
  readonly db: Database;
  readonly dbPath: string;

  constructor(configDir: string) {
    fs.mkdirSync(configDir, { recursive: true });
    this.dbPath = path.join(configDir, DB_FILE_NAME);
    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
    this.seedDefaults();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);

    const currentVersion = (this.db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number | null })
      .version ?? 0;

    if (currentVersion < 1) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS config (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS targets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          input TEXT NOT NULL,
          normalized_url TEXT NOT NULL UNIQUE,
          platform TEXT NOT NULL,
          display_name TEXT NOT NULL,
          requested_quality TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS recording_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          target_id INTEGER NOT NULL,
          pid INTEGER NOT NULL,
          selected_quality TEXT NOT NULL,
          output_path TEXT NOT NULL,
          started_at TEXT NOT NULL,
          ended_at TEXT,
          exit_code INTEGER,
          bytes_written INTEGER,
          FOREIGN KEY(target_id) REFERENCES targets(id)
        );

        CREATE INDEX IF NOT EXISTS idx_targets_enabled ON targets(enabled);
        CREATE INDEX IF NOT EXISTS idx_sessions_active ON recording_sessions(ended_at);
        CREATE INDEX IF NOT EXISTS idx_sessions_target ON recording_sessions(target_id);

        CREATE TABLE IF NOT EXISTS daemon_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      this.db
        .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(1, ?)")
        .run(new Date().toISOString());
    }
  }

  private seedDefaults(): void {
    const now = new Date().toISOString();
    const insertStmt = this.db.prepare(
      "INSERT OR IGNORE INTO config(key, value, updated_at) VALUES(?, ?, ?)"
    );

    for (const key of CONFIG_KEYS) {
      insertStmt.run(key, String(DEFAULT_CONFIG[key]), now);
    }
  }

  listConfigRaw(): Partial<Record<keyof AppConfig, string>> {
    const rows = this.db.prepare("SELECT key, value FROM config").all() as Array<{ key: keyof AppConfig; value: string }>;
    const result: Partial<Record<keyof AppConfig, string>> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  getConfigValueRaw(key: keyof AppConfig): string {
    const row = this.db.prepare("SELECT value FROM config WHERE key = ?").get(key) as { value: string } | undefined;
    if (!row) {
      throw new NotFoundError(`Config key ${key} not found`);
    }
    return row.value;
  }

  setConfigValueRaw(key: keyof AppConfig, value: string): void {
    this.db
      .prepare(
        `INSERT INTO config(key, value, updated_at) VALUES(?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, value, new Date().toISOString());
  }

  addTarget(target: NewStreamTarget): StreamTarget {
    const now = new Date().toISOString();
    let result: { lastInsertRowid: number | bigint };
    try {
      result = this.db
        .prepare(
          `INSERT INTO targets(input, normalized_url, platform, display_name, requested_quality, enabled, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
        )
        .run(
          target.input,
          target.normalizedUrl,
          target.platform,
          target.displayName,
          target.requestedQuality,
          now,
          now
        );
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed: targets.normalized_url")) {
        throw new ValidationError(`Target already exists: ${target.normalizedUrl}`);
      }
      throw error;
    }

    return this.getTargetById(Number(result.lastInsertRowid));
  }

  getTargetById(id: number): StreamTarget {
    const row = this.db.prepare("SELECT * FROM targets WHERE id = ?").get(id) as TargetRow | undefined;
    if (!row) {
      throw new NotFoundError(`Target id ${id} not found`);
    }
    return mapTargetRow(row);
  }

  listTargets(): StreamTarget[] {
    const rows = this.db
      .prepare("SELECT * FROM targets ORDER BY created_at ASC")
      .all() as TargetRow[];
    return rows.map(mapTargetRow);
  }

  listEnabledTargets(): StreamTarget[] {
    const rows = this.db
      .prepare("SELECT * FROM targets WHERE enabled = 1 ORDER BY created_at ASC")
      .all() as TargetRow[];
    return rows.map(mapTargetRow);
  }

  removeTarget(identifier: string): StreamTarget {
    const target = this.findTarget(identifier);
    this.db.prepare("DELETE FROM targets WHERE id = ?").run(target.id);
    return target;
  }

  updateTarget(identifier: string, patch: UpdateStreamTarget): StreamTarget {
    const target = this.findTarget(identifier);

    const merged = {
      input: patch.input ?? target.input,
      normalizedUrl: patch.normalizedUrl ?? target.normalizedUrl,
      platform: patch.platform ?? target.platform,
      displayName: patch.displayName ?? target.displayName,
      requestedQuality: patch.requestedQuality ?? target.requestedQuality,
      enabled: patch.enabled ?? target.enabled,
      updatedAt: new Date().toISOString()
    };

    this.db
      .prepare(
        `UPDATE targets
         SET input = ?, normalized_url = ?, platform = ?, display_name = ?, requested_quality = ?, enabled = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        merged.input,
        merged.normalizedUrl,
        merged.platform,
        merged.displayName,
        merged.requestedQuality,
        merged.enabled ? 1 : 0,
        merged.updatedAt,
        target.id
      );

    return this.getTargetById(target.id);
  }

  findTarget(identifier: string): StreamTarget {
    const numericId = Number(identifier);
    let row: TargetRow | undefined;

    if (Number.isInteger(numericId) && numericId > 0) {
      row = this.db.prepare("SELECT * FROM targets WHERE id = ?").get(numericId) as TargetRow | undefined;
    }

    if (!row) {
      row = this.db
        .prepare(
          `SELECT * FROM targets
           WHERE normalized_url = ? OR input = ? OR display_name = ?`
        )
        .get(identifier, identifier, identifier) as TargetRow | undefined;
    }

    if (!row) {
      throw new NotFoundError(`Target not found: ${identifier}`);
    }

    return mapTargetRow(row);
  }

  insertRecordingSession(input: {
    targetId: number;
    pid: number;
    selectedQuality: string;
    outputPath: string;
    startedAt: string;
  }): number {
    const result = this.db
      .prepare(
        `INSERT INTO recording_sessions(target_id, pid, selected_quality, output_path, started_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(input.targetId, input.pid, input.selectedQuality, input.outputPath, input.startedAt);

    return Number(result.lastInsertRowid);
  }

  finishRecordingSessionByPid(pid: number, input: { endedAt: string; exitCode: number | null }): void {
    this.db
      .prepare(
        `UPDATE recording_sessions
         SET ended_at = ?, exit_code = ?
         WHERE pid = ? AND ended_at IS NULL`
      )
      .run(input.endedAt, input.exitCode, pid);
  }

  listActiveSessions(): RecordingSession[] {
    const rows = this.db
      .prepare("SELECT * FROM recording_sessions WHERE ended_at IS NULL ORDER BY started_at ASC")
      .all() as SessionRow[];
    return rows.map(mapSessionRow);
  }

  listSessions(): RecordingSession[] {
    const rows = this.db
      .prepare("SELECT * FROM recording_sessions ORDER BY started_at ASC")
      .all() as SessionRow[];
    return rows.map(mapSessionRow);
  }

  getTargetStats(): TargetStats {
    const row = this.db
      .prepare(
        `SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) AS enabled
        FROM targets`
      )
      .get() as { total: number; enabled: number | null };

    return {
      total: row.total,
      enabled: row.enabled ?? 0
    };
  }

  getSessionStats(): SessionStats {
    const row = this.db
      .prepare(
        `SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN ended_at IS NULL THEN 1 ELSE 0 END) AS active,
          SUM(CASE WHEN ended_at IS NOT NULL THEN 1 ELSE 0 END) AS finished,
          SUM(CASE
            WHEN ended_at IS NOT NULL THEN CAST((julianday(ended_at) - julianday(started_at)) * 86400 AS INTEGER)
            ELSE 0
          END) AS total_duration_sec
         FROM recording_sessions`
      )
      .get() as {
        total: number;
        active: number | null;
        finished: number | null;
        total_duration_sec: number | null;
      };

    return {
      total: row.total,
      active: row.active ?? 0,
      finished: row.finished ?? 0,
      totalDurationSec: row.total_duration_sec ?? 0
    };
  }

  upsertDaemonMeta(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO daemon_meta(key, value, updated_at) VALUES(?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, value, new Date().toISOString());
  }

  getDaemonMeta(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM daemon_meta WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }
}

function mapTargetRow(row: TargetRow): StreamTarget {
  return {
    id: row.id,
    input: row.input,
    normalizedUrl: row.normalized_url,
    platform: row.platform,
    displayName: row.display_name,
    requestedQuality: row.requested_quality,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapSessionRow(row: SessionRow): RecordingSession {
  return {
    id: row.id,
    targetId: row.target_id,
    pid: row.pid,
    selectedQuality: row.selected_quality,
    outputPath: row.output_path,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    exitCode: row.exit_code,
    bytesWritten: row.bytes_written
  };
}
