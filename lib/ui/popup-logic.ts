import { t } from "../i18n";
import type { PageState, TabView } from "../messaging/protocol";
import type { BackendErrorKind, ModelInfo } from "../opencode/types";
import { describeError, type ErrorPresentation } from "./errors";

export function isTranslatableUrl(url: string | undefined): boolean {
  return url !== undefined && /^https?:\/\//i.test(url);
}

export function pageHostname(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export type ErrorView = ErrorPresentation;

export function errorView(
  kind: BackendErrorKind,
  retryAfterMs?: number,
  now: number = Date.now(),
): ErrorView | null {
  return kind === "aborted" ? null : describeError(kind, "popup", retryAfterMs, now);
}

export function pageFailure(
  page: PageState,
  dismissed: boolean,
): { error: ErrorView | null; showResume: boolean } {
  if (page.state !== "error") return { error: null, showResume: false };
  const error =
    dismissed || !page.error ? null : errorView(page.error.kind, page.error.retryAfterMs);
  if (!error) return { error: null, showResume: true };
  return { error, showResume: error.action === "chooseModel" };
}

export function mainAction(page: PageState): "translate" | "showOriginal" {
  if (page.state === "idle") return "translate";
  if (page.state === "error") return page.done > 0 ? "showOriginal" : "translate";
  return "showOriginal";
}

export type ProgressView = { percent: number; paused: boolean; stoppable: boolean };

export function progressView(page: PageState): ProgressView | null {
  const percent = page.total > 0 ? Math.min(100, Math.floor((page.done / page.total) * 100)) : 0;
  if (page.state === "translating") return { percent, paused: false, stoppable: true };
  if (page.state === "error" && page.total > 0) return { percent, paused: true, stoppable: false };
  return null;
}

export function variantFor(model: ModelInfo, current: string | undefined): string | undefined {
  if (current !== undefined && model.variants.includes(current)) return current;
  return model.variants.includes("none") ? "none" : undefined;
}

export function modelWarning(view: TabView): string | null {
  if (!view.pageModel.missing) return null;
  const wanted = view.settings.pageModel;
  const used = view.pageModel.model;
  if (!wanted || !used) return null;
  if (wanted.providerID === used.providerID && wanted.id === used.id) {
    return wanted.variant === undefined
      ? null
      : t("popup.effortMissing", { variant: wanted.variant, model: used.id });
  }
  return t("popup.modelMissing", { missing: wanted.id, fallback: used.id });
}
