import { originOf } from "../connections/list";
import type { ConnectionView, ProviderPreset } from "../connections/types";
import { needsKey } from "../provider/presets";

export type ProviderForm = {
  preset: ProviderPreset;
  name: string;
  baseUrl: string;
  apiKey: string;
};

export type FormValidation =
  | { ok: true }
  | { ok: false; field: "baseUrl" | "apiKey"; reason: "invalid" | "required" };

const PRESETS: Record<ProviderPreset, { baseUrl: string; name: string; needsKey: boolean }> = {
  deepseek: { baseUrl: "https://api.deepseek.com", name: "DeepSeek", needsKey: true },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", name: "OpenRouter", needsKey: true },
  ollama: { baseUrl: "http://localhost:11434/v1", name: "Ollama", needsKey: false },
  lmstudio: { baseUrl: "http://localhost:1234/v1", name: "LM Studio", needsKey: false },
  custom: { baseUrl: "", name: "Custom", needsKey: true },
};

export function presetDefaults(preset: ProviderPreset) {
  return { ...PRESETS[preset] };
}

function parseHttpOrigin(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return originOf(url.href);
  } catch {
    return null;
  }
}

export function validateProviderForm(
  form: ProviderForm,
  existing?: ConnectionView,
): FormValidation {
  const origin = parseHttpOrigin(form.baseUrl);
  if (origin === null) return { ok: false, field: "baseUrl", reason: "invalid" };
  if (form.apiKey.trim() !== "" || !needsKey(form.preset, form.baseUrl)) return { ok: true };
  const keepsKey = existing?.hasKey === true && parseHttpOrigin(existing.url) === origin;
  return keepsKey ? { ok: true } : { ok: false, field: "apiKey", reason: "required" };
}
