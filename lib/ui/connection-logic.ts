import { isLanOrigin, isLocalOrigin, originOf } from "../connections/list";
import type { ConnectionView, ProviderPreset } from "../connections/types";
import { needsKey, PRESETS } from "../provider/presets";

export type ProviderForm = {
  preset: ProviderPreset;
  name: string;
  baseUrl: string;
  apiKey: string;
};

export type FormValidation =
  | { ok: true }
  | { ok: false; field: "baseUrl" | "apiKey"; reason: "invalid" | "required" };

const NAMES: Record<ProviderPreset, string> = {
  deepseek: "DeepSeek",
  openrouter: "OpenRouter",
  openai: "OpenAI",
  mistral: "Mistral",
  ollama: "Ollama",
  lmstudio: "LM Studio",
  custom: "Custom",
};

export function presetDefaults(preset: ProviderPreset) {
  return { ...PRESETS[preset], name: NAMES[preset] };
}

export function validProviderUrl(baseUrl: string, android = false): boolean {
  try {
    const url = new URL(baseUrl.trim());
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        (isLocalOrigin(url.origin) || (!android && isLanOrigin(url.origin))))
    );
  } catch {
    return false;
  }
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
  android = false,
): FormValidation {
  const origin = parseHttpOrigin(form.baseUrl);
  if (origin === null || !validProviderUrl(form.baseUrl, android)) {
    return { ok: false, field: "baseUrl", reason: "invalid" };
  }
  if (form.apiKey.trim() !== "" || !needsKey(form.preset, form.baseUrl)) return { ok: true };
  const keepsKey = existing?.hasKey === true && parseHttpOrigin(existing.url) === origin;
  return keepsKey ? { ok: true } : { ok: false, field: "apiKey", reason: "required" };
}

export function cleartextSecret(baseUrl: string, secret: string, hasKey = false): boolean {
  if (secret.trim() === "" && !hasKey) return false;
  try {
    const url = new URL(baseUrl.trim());
    return url.protocol === "http:" && !isLocalOrigin(url.origin);
  } catch {
    return false;
  }
}
