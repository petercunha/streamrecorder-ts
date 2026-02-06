import type { QualityCandidate } from "../shared/types.js";

const QUALITY_REGEX = /^(\d{3,4})p(?:(\d{2,3}))?/i;

export function selectQuality(requested: string, available: string[]): string {
  if (available.length === 0) {
    return requested || "best";
  }

  const normalizedRequested = requested.trim().toLowerCase();
  if (!normalizedRequested) {
    return "best";
  }

  if (normalizedRequested === "best" || normalizedRequested === "worst") {
    return normalizedRequested;
  }

  const exact = available.find((q) => q.toLowerCase() === normalizedRequested);
  if (exact) {
    return exact;
  }

  const requestedParsed = parseQuality(normalizedRequested);
  const parsed = available
    .map((label) => parseQuality(label))
    .filter((candidate): candidate is QualityCandidate => candidate !== null);

  if (!requestedParsed || parsed.length === 0) {
    return available.includes("best") ? "best" : available[0] ?? "best";
  }

  const lowerOrEqual = parsed.filter((candidate) => candidate.height <= requestedParsed.height);
  if (lowerOrEqual.length > 0) {
    const bestLowerHeight = Math.max(...lowerOrEqual.map((candidate) => candidate.height));
    const sameHeight = lowerOrEqual.filter((candidate) => candidate.height === bestLowerHeight);
    const sixty = sameHeight.find((candidate) => candidate.fps === 60);
    if (sixty) {
      return sixty.label;
    }
    return sameHeight.sort((a, b) => b.fps - a.fps)[0]?.label ?? sameHeight[0]?.label ?? "best";
  }

  parsed.sort((a, b) => {
    const diffA = Math.abs(a.height - requestedParsed.height);
    const diffB = Math.abs(b.height - requestedParsed.height);
    if (diffA !== diffB) {
      return diffA - diffB;
    }
    if (a.fps !== b.fps) {
      return b.fps - a.fps;
    }
    return b.height - a.height;
  });

  return parsed[0]?.label ?? "best";
}

function parseQuality(value: string): QualityCandidate | null {
  const cleaned = value.split(/[,_+]/)[0]?.trim() ?? value;
  const match = QUALITY_REGEX.exec(cleaned);
  if (!match) {
    return null;
  }

  const height = Number.parseInt(match[1], 10);
  const fps = match[2] ? Number.parseInt(match[2], 10) : 30;

  if (!Number.isInteger(height) || !Number.isInteger(fps)) {
    return null;
  }

  return {
    label: value,
    height,
    fps
  };
}
