import { describe, expect, it } from "vitest";
import { shouldPostprocessRecording } from "../src/core/postprocess.js";

describe("shouldPostprocessRecording", () => {
  it("returns true when recording exits cleanly", () => {
    expect(
      shouldPostprocessRecording({
        enabled: true,
        isStopping: false,
        exitCode: 0,
        signal: null
      })
    ).toBe(true);
  });

  it("returns true when recording is terminated by signal", () => {
    expect(
      shouldPostprocessRecording({
        enabled: true,
        isStopping: false,
        exitCode: null,
        signal: "SIGTERM"
      })
    ).toBe(true);
  });

  it("returns false when disabled", () => {
    expect(
      shouldPostprocessRecording({
        enabled: false,
        isStopping: false,
        exitCode: 0,
        signal: null
      })
    ).toBe(false);
  });

  it("returns false when daemon is stopping", () => {
    expect(
      shouldPostprocessRecording({
        enabled: true,
        isStopping: true,
        exitCode: null,
        signal: "SIGTERM"
      })
    ).toBe(false);
  });

  it("returns false on non-zero non-signaled exits", () => {
    expect(
      shouldPostprocessRecording({
        enabled: true,
        isStopping: false,
        exitCode: 1,
        signal: null
      })
    ).toBe(false);
  });

  it("returns true for interrupted exit codes with null signal", () => {
    expect(
      shouldPostprocessRecording({
        enabled: true,
        isStopping: false,
        exitCode: 130,
        signal: null
      })
    ).toBe(true);
  });
});
