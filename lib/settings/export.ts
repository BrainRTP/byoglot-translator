import { z } from "zod";
import type { ConnectionRecord } from "../connections/types";
import type { GlobalSettings, ProfileOverrides, SiteRule, Template } from "./types";

export const EXPORT_FORMAT = "byoglot-export";
export const EXPORT_VERSION = 1;

const modelSchema = z.object({
  providerID: z.string(),
  id: z.string(),
  variant: z.string().optional(),
  connectionId: z.string().optional(),
});

export const exportSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  exportedAt: z.iso.datetime(),
  globals: z.object({
    sourceLang: z.string(),
    targetLang: z.string(),
    languagePromptEnabled: z.boolean(),
    languageProfile: z.string(),
    defaultTemplateId: z.string(),
  }),
  templates: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      builtin: z.boolean(),
      settings: z.object({
        prePrompt: z.string().optional(),
        targetLang: z.string().optional(),
        displayMode: z.enum(["replace", "bilingual"]).optional(),
        visibleOnly: z.boolean().optional(),
        pageModel: modelSchema.optional(),
        selectionModel: modelSchema.optional(),
      }),
    }),
  ),
  profileOverrides: z.record(
    z.string(),
    z.object({ text: z.string(), base: z.string(), savedAt: z.number() }),
  ),
  siteRules: z.array(z.object({ id: z.string(), pattern: z.string(), templateId: z.string() })),
  connections: z.array(
    z.object({
      id: z.string(),
      preset: z.enum(["deepseek", "openrouter", "ollama", "lmstudio", "custom"]),
      name: z.string(),
      baseUrl: z.string(),
    }),
  ),
});

export type ExportFile = z.infer<typeof exportSchema>;

export function buildExport(
  state: {
    globals: GlobalSettings;
    templates: Template[];
    profileOverrides: ProfileOverrides;
    siteRules: SiteRule[];
    connections: ConnectionRecord[];
  },
  now: Date,
): ExportFile {
  const { sourceLang, targetLang, languagePromptEnabled, languageProfile, defaultTemplateId } =
    state.globals;
  return exportSchema.parse({
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    globals: { sourceLang, targetLang, languagePromptEnabled, languageProfile, defaultTemplateId },
    templates: state.templates,
    profileOverrides: state.profileOverrides,
    siteRules: state.siteRules,
    connections: state.connections
      .filter((connection) => connection.kind === "provider")
      .map(({ id, preset, name, baseUrl }) => ({ id, preset, name, baseUrl })),
  });
}

export function parseExport(raw: unknown): ExportFile {
  return exportSchema.parse(raw);
}
