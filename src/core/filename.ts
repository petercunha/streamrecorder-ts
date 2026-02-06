import path from "node:path";
import type { StreamTarget } from "../shared/types.js";
import { formatIsoForFilename } from "../utils/process.js";

export function buildRecordingPath(input: {
  recordingsDir: string;
  filenameTemplate: string;
  target: StreamTarget;
  quality: string;
  startedAt?: Date;
}): string {
  const startedAt = input.startedAt ?? new Date();
  const slug = slugify(input.target.displayName || input.target.id.toString());
  const startedAtToken = formatIsoForFilename(startedAt);
  const quality = sanitizeSegment(input.quality);

  const baseName = input.filenameTemplate
    .replaceAll("{slug}", slug)
    .replaceAll("{startedAt}", startedAtToken)
    .replaceAll("{quality}", quality);

  const withExtension = path.extname(baseName) ? baseName : `${baseName}.ts`;
  return path.join(input.recordingsDir, withExtension);
}

function slugify(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "stream";
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, "_");
}
