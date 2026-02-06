import { describe, expect, it } from "vitest";
import { normalizeTargetInput } from "../src/core/target.js";

describe("normalizeTargetInput", () => {
  it("defaults bare streamer names to twitch", () => {
    const result = normalizeTargetInput("example_streamer");
    expect(result.normalizedUrl).toBe("https://twitch.tv/example_streamer");
    expect(result.platform).toBe("twitch");
    expect(result.displayName).toBe("example_streamer");
  });

  it("normalizes URL and infers display name", () => {
    const result = normalizeTargetInput("https://www.twitch.tv/someone/");
    expect(result.normalizedUrl).toBe("https://www.twitch.tv/someone");
    expect(result.platform).toBe("twitch");
    expect(result.displayName).toBe("someone");
  });

  it("marks unknown hosts as generic", () => {
    const result = normalizeTargetInput("https://example.com/live/channel");
    expect(result.platform).toBe("generic");
    expect(result.displayName).toBe("channel");
  });
});
