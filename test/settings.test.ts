import { describe, expect, it } from "vitest";
import { mergeConfig, parseConfigValue } from "../src/config/settings.js";
import { ValidationError } from "../src/shared/errors.js";

describe("postprocessToMp4 config", () => {
  it("parses common true values", () => {
    expect(parseConfigValue("postprocessToMp4", "true")).toBe(true);
    expect(parseConfigValue("postprocessToMp4", "1")).toBe(true);
    expect(parseConfigValue("postprocessToMp4", "yes")).toBe(true);
    expect(parseConfigValue("postprocessToMp4", "on")).toBe(true);
  });

  it("parses common false values", () => {
    expect(parseConfigValue("postprocessToMp4", "false")).toBe(false);
    expect(parseConfigValue("postprocessToMp4", "0")).toBe(false);
    expect(parseConfigValue("postprocessToMp4", "no")).toBe(false);
    expect(parseConfigValue("postprocessToMp4", "off")).toBe(false);
  });

  it("rejects invalid values", () => {
    expect(() => parseConfigValue("postprocessToMp4", "maybe")).toThrow(ValidationError);
  });

  it("defaults to false in merged config", () => {
    const config = mergeConfig({});
    expect(config.postprocessToMp4).toBe(false);
  });

  it("uses persisted boolean in merged config", () => {
    const config = mergeConfig({
      postprocessToMp4: "true"
    });
    expect(config.postprocessToMp4).toBe(true);
  });
});
