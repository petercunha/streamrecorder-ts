import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DbClient } from "../src/db/client.js";
import { NotFoundError } from "../src/shared/errors.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("DbClient.removeTarget", () => {
  it("removes a target even when it has recording sessions", () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "sr-db-test-"));
    tempDirs.push(configDir);

    const db = new DbClient(configDir);

    try {
      const target = db.addTarget({
        input: "xqc",
        normalizedUrl: "https://twitch.tv/xqc",
        platform: "twitch",
        displayName: "xqc",
        requestedQuality: "best"
      });

      db.insertRecordingSession({
        targetId: target.id,
        pid: 4242,
        selectedQuality: "best",
        outputPath: "/tmp/xqc.ts",
        startedAt: new Date().toISOString()
      });

      const removed = db.removeTarget("xqc");
      expect(removed.id).toBe(target.id);
      expect(db.listSessions()).toHaveLength(0);
      expect(() => db.getTargetById(target.id)).toThrow(NotFoundError);
    } finally {
      db.close();
    }
  });
});
