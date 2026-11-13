import { z } from "zod";
import type { ConnectionRecord } from "../connections/types";
import type { GlobalSettings, ProfileOverrides, SiteRule, Template } from "./types";

export const EXPORT_FORMAT = "byoglot-export";
export const EXPORT_VERSION = 1;

const modelSchema = z.strictObject({
  providerID: z.string(),
  id: z.string(),
  variant: z.string().optional(),
  connectionId: z.string().optional(),
});

export const exportSchema = z.strictObject({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  exportedAt: z.iso.datetime(),
  globals: z.strictObject({
    sourceLang: z.string(),
    targetLang: z.string(),
    languagePromptEnabled: z.boolean(),
    languageProfile: z.string(),
    defaultTemplateId: z.string(),
  }),
  templates: z.array(
    z.strictObject({
      id: z.string(),
      name: z.string(),
      builtin: z.boolean(),
      settings: z.strictObject({
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
    z.strictObject({ text: z.string(), base: z.string(), savedAt: z.number() }),
  ),
  siteRules: z.array(
    z.strictObject({ id: z.string(), pattern: z.string(), templateId: z.string() }),
  ),
  connections: z.array(
    z.strictObject({
      id: z.string(),
      preset: z.enum([
        "deepseek",
        "openrouter",
        "openai",
        "mistral",
        "ollama",
        "lmstudio",
        "custom",
      ]),
      name: z.string(),
      baseUrl: z.string(),
    }),
  ),
});

export type ExportFile = z.infer<typeof exportSchema>;

function pick<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (Object.hasOwn(value, key)) result[key] = value[key];
  }
  return result;
}

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
    templates: state.templates.map((template) => {
      const settings = pick(template.settings, [
        "prePrompt",
        "targetLang",
        "displayMode",
        "visibleOnly",
        "pageModel",
        "selectionModel",
      ]);
      for (const key of ["pageModel", "selectionModel"] as const) {
        const model = settings[key];
        if (model) settings[key] = pick(model, ["providerID", "id", "variant", "connectionId"]);
      }
      return { ...pick(template, ["id", "name", "builtin"]), settings };
    }),
    profileOverrides: Object.fromEntries(
      Object.entries(state.profileOverrides).map(([id, override]) => [
        id,
        pick(override, ["text", "base", "savedAt"]),
      ]),
    ),
    siteRules: state.siteRules.map((rule) => pick(rule, ["id", "pattern", "templateId"])),
    connections: state.connections
      .filter((connection) => connection.kind === "provider")
      .map(({ id, preset, name, baseUrl }) => ({ id, preset, name, baseUrl })),
  });
}

export function parseExport(raw: unknown): ExportFile {
  return exportSchema.parse(raw);
}
