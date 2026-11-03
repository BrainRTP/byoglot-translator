import type { ModelInfo, ModelRef } from "../opencode/types";
import { isValidPattern } from "../settings/site-rules";
import type { DisplayMode, SiteRule, Template, TemplateSettings } from "../settings/types";
import { variantFor } from "./popup-logic";

export type ModelId = { providerID: string; id: string };

export type TemplateForm = {
  name: string;
  prePrompt: string;
  targetLang: string;
  displayMode: "" | DisplayMode;
  pageModel: ModelId | null;
  pageVariant: string;
  selectionModel: ModelId | null;
  selectionVariant: string;
};

function splitModel(ref: ModelRef | undefined): { model: ModelId | null; variant: string } {
  if (!ref) return { model: null, variant: "" };
  return { model: { providerID: ref.providerID, id: ref.id }, variant: ref.variant ?? "" };
}

export function templateToForm(t: Template): TemplateForm {
  const s = t.settings;
  const page = splitModel(s.pageModel);
  const selection = splitModel(s.selectionModel);
  return {
    name: t.name,
    prePrompt: s.prePrompt ?? "",
    targetLang: s.targetLang ?? "",
    displayMode: s.displayMode ?? "",
    pageModel: page.model,
    pageVariant: page.variant,
    selectionModel: selection.model,
    selectionVariant: selection.variant,
  };
}

function joinModel(model: ModelId | null, variant: string): ModelRef | undefined {
  if (!model) return undefined;
  const ref: ModelRef = { providerID: model.providerID, id: model.id };
  return variant === "" ? ref : { ...ref, variant };
}

/** Empty fields are omitted so they fall back to the global settings. An effort needs an explicit model. */
export function formToSettings(form: TemplateForm): TemplateSettings {
  const out: TemplateSettings = {};
  if (form.prePrompt.trim() !== "") out.prePrompt = form.prePrompt;
  if (form.targetLang !== "") out.targetLang = form.targetLang;
  if (form.displayMode !== "") out.displayMode = form.displayMode;
  const page = joinModel(form.pageModel, form.pageVariant);
  if (page) out.pageModel = page;
  const selection = joinModel(form.selectionModel, form.selectionVariant);
  if (selection) out.selectionModel = selection;
  return out;
}

export function sameForm(a: TemplateForm, b: TemplateForm): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function modelVariants(models: ModelInfo[], chosen: ModelId | null): string[] {
  if (!chosen) return [];
  return (
    models.find((m) => m.providerID === chosen.providerID && m.id === chosen.id)?.variants ?? []
  );
}

/** Keeps "" (model default) and supported variants; otherwise falls back like the popup does. */
export function reconcileVariant(
  models: ModelInfo[],
  model: ModelId | null,
  current: string,
): string {
  if (!model) return "";
  const info = models.find((m) => m.providerID === model.providerID && m.id === model.id);
  if (!info || current === "") return current;
  return variantFor(info, current) ?? "";
}

export type RuleError = "empty" | "invalid" | "duplicate";

export function ruleError(pattern: string, rules: SiteRule[], ignoreId?: string): RuleError | null {
  const p = pattern.trim().toLowerCase();
  if (p === "") return "empty";
  if (!isValidPattern(p)) return "invalid";
  const taken = rules.some((r) => r.id !== ignoreId && r.pattern.trim().toLowerCase() === p);
  return taken ? "duplicate" : null;
}

export function rulesUsing(rules: SiteRule[], templateId: string): number {
  return rules.filter((r) => r.templateId === templateId).length;
}

export function filterTemplates(
  list: Template[],
  query: string,
  nameOf: (t: Template) => string,
): Template[] {
  const q = query.trim().toLowerCase();
  if (q === "") return list;
  return list.filter((t) => nameOf(t).toLowerCase().includes(q));
}

export function groupByProvider(models: ModelInfo[]): [string, ModelInfo[]][] {
  const byProvider = new Map<string, ModelInfo[]>();
  for (const m of models)
    byProvider.set(m.providerID, [...(byProvider.get(m.providerID) ?? []), m]);
  return [...byProvider.entries()];
}

export const modelKey = (m: ModelId): string => `${m.providerID}/${m.id}`;

export function isFirefoxAgent(userAgent: string): boolean {
  return userAgent.includes("Firefox");
}
