import { describe, expect, it } from "vitest";
import { effortParams, effortVariants, needsKey, PRESETS } from "../../../lib/provider/presets";

describe("PRESETS", () => {
  it("has the base urls and key requirements", () => {
    expect(PRESETS.deepseek).toEqual({ baseUrl: "https://api.deepseek.com", needsKey: true });
    expect(PRESETS.openrouter).toEqual({ baseUrl: "https://openrouter.ai/api/v1", needsKey: true });
    expect(PRESETS.ollama).toEqual({ baseUrl: "http://localhost:11434/v1", needsKey: false });
    expect(PRESETS.lmstudio).toEqual({ baseUrl: "http://localhost:1234/v1", needsKey: false });
    expect(PRESETS.custom).toEqual({ baseUrl: "", needsKey: true });
  });
});

describe("needsKey", () => {
  it("custom on a local origin does not need a key", () => {
    expect(needsKey("custom", "http://localhost:8080/v1")).toBe(false);
    expect(needsKey("custom", "https://api.example.com")).toBe(true);
    expect(needsKey("custom", "not a url")).toBe(true);
    expect(needsKey("deepseek", "http://localhost")).toBe(true);
  });
});

describe("effortVariants", () => {
  it("deepseek prepends none to the supported levels", () => {
    expect(
      effortVariants("deepseek", { id: "m", effort: { supported_levels: ["low", "high"] } }),
    ).toEqual(["none", "low", "high"]);
    expect(effortVariants("deepseek", { id: "m" })).toEqual(["none"]);
  });

  it("openrouter depends on the reasoning parameter", () => {
    expect(effortVariants("openrouter", { id: "m", supported_parameters: ["reasoning"] })).toEqual([
      "none",
      "low",
      "medium",
      "high",
    ]);
    expect(effortVariants("openrouter", { id: "m", supported_parameters: ["tools"] })).toEqual([
      "none",
    ]);
  });

  it("others give only none", () => {
    expect(effortVariants("ollama", { id: "m" })).toEqual(["none"]);
    expect(effortVariants("custom", { id: "m" })).toEqual(["none"]);
  });
});

describe("effortParams", () => {
  it("deepseek always sends reasoning_effort", () => {
    expect(effortParams("deepseek", undefined)).toEqual({ reasoning_effort: "none" });
    expect(effortParams("deepseek", "max")).toEqual({ reasoning_effort: "max" });
  });

  it("openrouter sends reasoning only for a non-none variant", () => {
    expect(effortParams("openrouter", "high")).toEqual({ reasoning: { effort: "high" } });
    expect(effortParams("openrouter", "none")).toEqual({});
    expect(effortParams("openrouter", undefined)).toEqual({});
  });

  it("others send nothing", () => {
    expect(effortParams("ollama", "high")).toEqual({});
  });
});
