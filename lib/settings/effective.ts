import type { ModelInfo, ModelRef } from "../opencode/types";
import type { EffectiveSettings, GlobalSettings, Template, TemplateSettings } from "./types";

export const SELECTION_DEFAULT_EFFORT = "high";

const FAVORITE = { providerID: "deepseek", id: "deepseek-flash" };

function copyModel(m: ModelRef | null | undefined): ModelRef | null {
  return m ? { ...m } : null;
}

function sameModel(a: ModelRef | null, b: ModelRef | null, activeId: string | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.providerID === b.providerID &&
    a.id === b.id &&
    a.variant === b.variant &&
    (a.connectionId ?? activeId) === (b.connectionId ?? activeId)
  );
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
    visibleOnly: s.visibleOnly ?? false,
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
    e.visibleOnly === base.visibleOnly &&
    sameModel(e.pageModel, base.pageModel, activeId) &&
    sameModel(e.selectionModel, base.selectionModel, activeId)
  );
}

export function toTemplateSettings(e: EffectiveSettings): TemplateSettings {
  const out: TemplateSettings = {
    prePrompt: e.prePrompt,
    targetLang: e.targetLang,
    displayMode: e.displayMode,
  };
  if (e.visibleOnly) out.visibleOnly = true;
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

export function pinnedModel(
  base: ModelRef,
  info: ModelInfo | undefined,
  pinnedEffort: string | null,
): ModelRef {
  const { variant: _drop, ...rest } = base;
  const pick = !info
    ? (pinnedEffort ?? SELECTION_DEFAULT_EFFORT)
    : pinnedEffort && info.variants.includes(pinnedEffort)
      ? pinnedEffort
      : info.variants.includes(SELECTION_DEFAULT_EFFORT)
        ? SELECTION_DEFAULT_EFFORT
        : undefined;
  return pick === undefined ? rest : { ...rest, variant: pick };
}

export function pickInitialModels(
  models: ModelInfo[],
  def: ModelInfo | null,
  connectionId: string,
): { pageModel: ModelRef | null; selectionModel: ModelRef | null } {
  const pair = (m: ModelInfo, variant: string | undefined) => ({
    pageModel: withVariant(m, variant, connectionId),
    selectionModel: withVariant(
      m,
      m.variants.includes(SELECTION_DEFAULT_EFFORT) ? SELECTION_DEFAULT_EFFORT : variant,
      connectionId,
    ),
  });
  const favorite = models.find((m) => m.providerID === FAVORITE.providerID && m.id === FAVORITE.id);
  if (favorite) return pair(favorite, favorite.variants.includes("none") ? "none" : undefined);
  if (!def) return { pageModel: null, selectionModel: null };
  return pair(def, def.variants.includes("none") ? "none" : def.variants[0]);
}
