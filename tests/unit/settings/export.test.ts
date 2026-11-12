import { expect, it } from "vitest";
import {
  BUILTIN_TEMPLATE_ID,
  builtinTemplate,
  DEFAULT_GLOBALS,
} from "../../../lib/settings/defaults";
import { buildExport, parseExport } from "../../../lib/settings/export";

const state = {
  globals: { ...DEFAULT_GLOBALS, targetLang: "ru" },
  templates: [builtinTemplate()],
  profileOverrides: { ru: { text: "mine", base: "theirs", savedAt: 1 } },
  siteRules: [{ id: "r1", pattern: "*.example.com", templateId: BUILTIN_TEMPLATE_ID }],
  connections: [
    {
      id: "c1",
      kind: "provider",
      preset: "deepseek",
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-secret",
      pageModel: null,
      selectionModel: null,
    },
    {
      id: "c2",
      kind: "opencode",
      url: "http://127.0.0.1:4096",
      username: "u",
      password: "p-secret",
      pageModel: null,
      selectionModel: null,
    },
  ],
} satisfies Parameters<typeof buildExport>[0];

it("keeps provider connections without secrets and drops opencode", () => {
  const file = buildExport(state, new Date("2026-11-12T10:00:00Z"));
  expect(file.connections).toEqual([
    { id: "c1", preset: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com" },
  ]);
  const text = JSON.stringify(file);
  expect(text).not.toContain("sk-secret");
  expect(text).not.toContain("p-secret");
  expect(file.exportedAt).toBe("2026-11-12T10:00:00.000Z");
});

it("exports only the portable globals", () => {
  const file = buildExport(state, new Date(0));
  expect(Object.keys(file.globals).sort()).toEqual([
    "defaultTemplateId",
    "languageProfile",
    "languagePromptEnabled",
    "sourceLang",
    "targetLang",
  ]);
});

it("round-trips through parseExport", () => {
  const file = buildExport(state, new Date(0));
  expect(parseExport(JSON.parse(JSON.stringify(file)))).toEqual(file);
});

it.each([
  ["a wrong format", { format: "other" }],
  ["a newer version", { version: 2 }],
  ["a template without an id", { templates: [{ name: "x", builtin: false, settings: {} }] }],
])("rejects %s", (_name, patch) => {
  const file = { ...buildExport(state, new Date(0)), ...patch };
  expect(() => parseExport(file)).toThrow();
});

it("rejects an unknown key", () => {
  const file = buildExport(state, new Date(0));
  expect(() => parseExport({ ...file, unknown: true })).toThrow();
  expect(() =>
    parseExport({
      ...file,
      connections: file.connections.map((connection) => ({ ...connection, apiKey: "sk-secret" })),
    }),
  ).toThrow();
});
