import type { ModelInfo, ModelRef } from "../opencode/types";
import type { EffectiveSettings, GlobalSettings, Template, TemplateSettings } from "./types";

const FAVORITE = { providerID: "deepseek", id: "deepseek-flash" };

function copyModel(m: ModelRef | null | undefined): ModelRef | null {
  return m ? { ...m } : null;
}

function sameModel(a: ModelRef | null, b: ModelRef | null): boolean {
  if (!a || !b) return a === b;
  return a.providerID === b.providerID && a.id === b.id && a.variant === b.variant;
}

export function applyTemplate(t: Template, g: GlobalSettings): EffectiveSettings {
  const s = t.settings;
  return {
    templateId: t.id,
    prePrompt: s.prePrompt ?? "",
    sourceLang: g.sourceLang,
    targetLang: s.targetLang ?? g.targetLang,
    displayMode: s.displayMode ?? g.displayMode,
    pageModel: copyModel(s.pageModel ?? g.pageModel),
    selectionModel: copyModel(s.selectionModel ?? g.selectionModel),
  };
}

export function isModified(e: EffectiveSettings, t: Template, g: GlobalSettings): boolean {
  const base = applyTemplate(t, g);
  return !(
    e.prePrompt === base.prePrompt &&
    e.sourceLang === base.sourceLang &&
    e.targetLang === base.targetLang &&
    e.displayMode === base.displayMode &&
    sameModel(e.pageModel, base.pageModel) &&
    sameModel(e.selectionModel, base.selectionModel)
  );
}

export function toTemplateSettings(e: EffectiveSettings): TemplateSettings {
  const out: TemplateSettings = {
    prePrompt: e.prePrompt,
    targetLang: e.targetLang,
    displayMode: e.displayMode,
  };
  if (e.pageModel) out.pageModel = { ...e.pageModel };
  if (e.selectionModel) out.selectionModel = { ...e.selectionModel };
  return out;
}

export function resolveModel(
  ref: ModelRef | null,
  models: ModelInfo[],
  fallback: ModelRef | null,
): { model: ModelRef | null; missing: boolean } {
  if (!ref) return { model: fallback, missing: false };
  const found = models.some((m) => m.providerID === ref.providerID && m.id === ref.id);
  return found ? { model: ref, missing: false } : { model: fallback, missing: true };
}

function withVariant(m: ModelInfo, variant: string | undefined): ModelRef {
  return variant === undefined
    ? { providerID: m.providerID, id: m.id }
    : { providerID: m.providerID, id: m.id, variant };
}

export function pickInitialModels(
  models: ModelInfo[],
  def: ModelInfo | null,
): { pageModel: ModelRef | null; selectionModel: ModelRef | null } {
  const favorite = models.find((m) => m.providerID === FAVORITE.providerID && m.id === FAVORITE.id);
  if (favorite) {
    const variant = favorite.variants.includes("none") ? "none" : undefined;
    return {
      pageModel: withVariant(favorite, variant),
      selectionModel: withVariant(favorite, variant),
    };
  }
  if (!def) return { pageModel: null, selectionModel: null };
  const variant = def.variants.includes("none") ? "none" : def.variants[0];
  return { pageModel: withVariant(def, variant), selectionModel: withVariant(def, variant) };
}
