import { describe, expect, it } from "vitest";
import { selectQuality } from "../src/core/quality.js";

describe("selectQuality", () => {
  it("returns exact quality if available", () => {
    expect(selectQuality("720p", ["1080p", "720p", "480p"]))
      .toBe("720p");
  });

  it("falls back to best lower quality", () => {
    expect(selectQuality("1080p", ["720p", "480p"]))
      .toBe("720p");
  });

  it("prefers 60fps at same lower height", () => {
    expect(selectQuality("1080p", ["720p", "720p60", "480p"]))
      .toBe("720p60");
  });

  it("picks closest available if no lower quality exists", () => {
    expect(selectQuality("360p", ["720p", "1080p"]))
      .toBe("720p");
  });

  it("returns best when requested is non-numeric and not exact", () => {
    expect(selectQuality("source", ["best", "720p", "worst"]))
      .toBe("best");
  });

  it("handles quality labels with suffixes", () => {
    expect(selectQuality("1080p", ["720p60_alt", "720p", "480p"]))
      .toBe("720p60_alt");
  });
});
