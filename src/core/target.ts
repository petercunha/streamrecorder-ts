import { ValidationError } from "../shared/errors.js";

export interface NormalizedTarget {
  input: string;
  normalizedUrl: string;
  platform: string;
  displayName: string;
}

export function normalizeTargetInput(input: string): NormalizedTarget {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new ValidationError("Target input cannot be empty");
  }

  if (hasScheme(trimmed)) {
    const url = new URL(trimmed);
    url.hash = "";
    const normalizedUrl = stripTrailingSlash(url.toString());
    const platform = platformFromHost(url.hostname);
    const displayName = inferDisplayNameFromUrl(url);
    return {
      input: trimmed,
      normalizedUrl,
      platform,
      displayName
    };
  }

  const username = trimmed.replace(/^@/, "");
  if (!/^[A-Za-z0-9_\-.]+$/.test(username)) {
    throw new ValidationError(`Invalid streamer name: ${trimmed}`);
  }

  return {
    input: trimmed,
    normalizedUrl: `https://twitch.tv/${username}`,
    platform: "twitch",
    displayName: username
  };
}

function hasScheme(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function platformFromHost(hostname: string): string {
  const host = hostname.toLowerCase();
  if (host.includes("twitch.tv")) {
    return "twitch";
  }
  if (host.includes("youtube.com") || host.includes("youtu.be")) {
    return "youtube";
  }
  if (host.includes("kick.com")) {
    return "kick";
  }
  return "generic";
}

function inferDisplayNameFromUrl(url: URL): string {
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length === 0) {
    return url.hostname;
  }
  return segments[segments.length - 1] ?? url.hostname;
}
