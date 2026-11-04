import type { z } from "zod";
import type { ProviderPreset } from "../connections/types";
import type { modelRawSchema } from "./schemas";

type RawModel = z.infer<typeof modelRawSchema>;

export const PRESETS: Record<ProviderPreset, { baseUrl: string; needsKey: boolean }> = {
  deepseek: { baseUrl: "https://api.deepseek.com", needsKey: true },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", needsKey: true },
  ollama: { baseUrl: "http://localhost:11434/v1", needsKey: false },
  lmstudio: { baseUrl: "http://localhost:1234/v1", needsKey: false },
  custom: { baseUrl: "", needsKey: true },
};

export function effortVariants(preset: ProviderPreset, raw: RawModel): string[] {
  if (preset === "deepseek") return ["none", ...(raw.effort?.supported_levels ?? [])];
  if (preset === "openrouter" && raw.supported_parameters?.includes("reasoning")) {
    return ["none", "low", "medium", "high"];
  }
  return ["none"];
}

export function effortParams(
  preset: ProviderPreset,
  variant: string | undefined,
): Record<string, unknown> {
  if (preset === "deepseek") return { reasoning_effort: variant ?? "none" };
  if (preset === "openrouter" && variant !== undefined && variant !== "none") {
    return { reasoning: { effort: variant } };
  }
  return {};
}
