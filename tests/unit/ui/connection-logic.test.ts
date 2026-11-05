import { describe, expect, it } from "vitest";
import type { ConnectionView } from "../../../lib/connections/types";
import {
  cleartextSecret,
  presetDefaults,
  validateProviderForm,
} from "../../../lib/ui/connection-logic";

const existing: ConnectionView = {
  id: "c1",
  kind: "provider",
  name: "DeepSeek",
  url: "https://api.deepseek.com",
  preset: "deepseek",
  hasKey: true,
  active: true,
};

describe("presetDefaults", () => {
  it("fills url and name from the preset", () => {
    expect(presetDefaults("deepseek")).toEqual({
      baseUrl: "https://api.deepseek.com",
      name: "DeepSeek",
      needsKey: true,
    });
    expect(presetDefaults("custom")).toEqual({ baseUrl: "", name: "Custom", needsKey: true });
  });

  it("local presets do not need a key", () => {
    expect(presetDefaults("ollama").needsKey).toBe(false);
    expect(presetDefaults("lmstudio").needsKey).toBe(false);
    expect(presetDefaults("openrouter").needsKey).toBe(true);
  });
});

describe("validateProviderForm", () => {
  const deepseek = {
    preset: "deepseek" as const,
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    apiKey: "",
  };

  it("requires a key for a new provider that needs one", () => {
    expect(validateProviderForm(deepseek)).toEqual({
      ok: false,
      field: "apiKey",
      reason: "required",
    });
    expect(validateProviderForm({ ...deepseek, apiKey: "sk-1" })).toEqual({ ok: true });
  });

  it("does not require a key for ollama", () => {
    const form = {
      preset: "ollama" as const,
      name: "Ollama",
      baseUrl: "http://localhost:11434/v1",
      apiKey: "",
    };
    expect(validateProviderForm(form)).toEqual({ ok: true });
  });

  it("does not require a key for custom on localhost", () => {
    const form = {
      preset: "custom" as const,
      name: "Local",
      baseUrl: "http://localhost:8080/v1",
      apiKey: "",
    };
    expect(validateProviderForm(form)).toEqual({ ok: true });
    expect(validateProviderForm({ ...form, baseUrl: "https://example.com/v1" })).toMatchObject({
      ok: false,
      field: "apiKey",
    });
  });

  it("requires a key when an edit changes the origin", () => {
    const form = { ...deepseek, baseUrl: "https://example.com/v1" };
    expect(validateProviderForm(form, existing)).toEqual({
      ok: false,
      field: "apiKey",
      reason: "required",
    });
  });

  it("keeps the saved key when the origin is unchanged", () => {
    const form = { ...deepseek, baseUrl: "https://api.deepseek.com/v2" };
    expect(validateProviderForm(form, existing)).toEqual({ ok: true });
  });

  it("rejects non-http urls and garbage", () => {
    expect(validateProviderForm({ ...deepseek, baseUrl: "ftp://x", apiKey: "k" })).toEqual({
      ok: false,
      field: "baseUrl",
      reason: "invalid",
    });
    expect(validateProviderForm({ ...deepseek, baseUrl: "", apiKey: "k" })).toEqual({
      ok: false,
      field: "baseUrl",
      reason: "invalid",
    });
  });
});

describe("cleartextSecret", () => {
  it("warns for a remote http url with a key", () => {
    expect(cleartextSecret("http://example.com/v1", "k")).toBe(true);
    expect(cleartextSecret("http://example.com/v1", "", true)).toBe(true);
  });

  it("stays quiet for https, local hosts, no key or a bad url", () => {
    expect(cleartextSecret("https://example.com", "k")).toBe(false);
    expect(cleartextSecret("http://localhost:11434", "k")).toBe(false);
    expect(cleartextSecret("http://127.0.0.1:4096", "k")).toBe(false);
    expect(cleartextSecret("http://example.com", " ")).toBe(false);
    expect(cleartextSecret("nope", "k")).toBe(false);
  });
});
