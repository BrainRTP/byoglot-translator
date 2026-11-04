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

export function ownModel(
  ref: ModelRef | null | undefined,
  activeId: string | null,
): ModelRef | null {
  return ref && ref.connectionId === activeId ? ref : null;
}

export function stampModel(ref: ModelRef | null | undefined, activeId: string): ModelRef | null {
  if (!ref) return null;
  return ref.connectionId === undefined ? { ...ref, connectionId: activeId } : ref;
}

export function applyTemplate(
  t: Template,
  g: GlobalSettings,
  activeId: string | null,
): EffectiveSettings {
  const s = t.settings;
  return {
    templateId: t.id,
    prePrompt: s.prePrompt ?? "",
    sourceLang: g.sourceLang,
    targetLang: s.targetLang ?? g.targetLang,
    displayMode: s.displayMode ?? g.displayMode,
    pageModel: copyModel(ownModel(s.pageModel, activeId) ?? g.pageModel),
    selectionModel: copyModel(ownModel(s.selectionModel, activeId) ?? g.selectionModel),
  };
}

export function isModified(
  e: EffectiveSettings,
  t: Template,
  g: GlobalSettings,
  activeId: string | null,
): boolean {
  const base = applyTemplate(t, g, activeId);
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

function withVariant(m: ModelInfo, variant: string | undefined, connectionId: string): ModelRef {
  return variant === undefined
    ? { providerID: m.providerID, id: m.id, connectionId }
    : { providerID: m.providerID, id: m.id, variant, connectionId };
}

export function pickInitialModels(
  models: ModelInfo[],
  def: ModelInfo | null,
  connectionId: string,
): { pageModel: ModelRef | null; selectionModel: ModelRef | null } {
  const favorite = models.find((m) => m.providerID === FAVORITE.providerID && m.id === FAVORITE.id);
  if (favorite) {
    const variant = favorite.variants.includes("none") ? "none" : undefined;
    return {
      pageModel: withVariant(favorite, variant, connectionId),
      selectionModel: withVariant(favorite, variant, connectionId),
    };
  }
  if (!def) return { pageModel: null, selectionModel: null };
  const variant = def.variants.includes("none") ? "none" : def.variants[0];
  return {
    pageModel: withVariant(def, variant, connectionId),
    selectionModel: withVariant(def, variant, connectionId),
  };
}
