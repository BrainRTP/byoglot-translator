import type { ConnectionKind } from "../connections/types";
import { formatRetryAfter, type MessageKey, resolveLang, t } from "../i18n";
import type { BackendErrorKind } from "../opencode/types";

export type ErrorSurface = "popup" | "card";
export type ErrorAction = "retry" | "chooseModel" | "connect";

export type ErrorPresentation = {
  tone: "er" | "wn";
  title: string;
  body: string;
  hint?: string;
  action: ErrorAction;
};

export type PresentableKind = Exclude<BackendErrorKind, "aborted">;

const TITLES: Record<PresentableKind, MessageKey> = {
  offline: "error.offline.title",
  unauthorized: "error.unauthorized.title",
  rate_limit: "error.rate_limit.title",
  provider_auth: "error.provider_auth.title",
  provider_error: "error.provider_error.title",
  bad_response: "error.bad_response.title",
  incompatible: "error.incompatible.title",
  no_model: "error.no_model.title",
};

const BODIES: Record<PresentableKind, Record<ErrorSurface, MessageKey>> = {
  offline: { popup: "popup.offlineBody", card: "error.offline" },
  unauthorized: { popup: "error.unauthorized", card: "error.unauthorized" },
  rate_limit: { popup: "popup.rateLimit", card: "error.rate_limit" },
  provider_auth: { popup: "popup.providerAuthBody", card: "error.provider_auth" },
  provider_error: { popup: "error.provider_error", card: "error.provider_error" },
  bad_response: { popup: "error.bad_response", card: "error.bad_response" },
  incompatible: { popup: "error.incompatible", card: "error.incompatible" },
  no_model: { popup: "error.no_model", card: "error.no_model" },
};

const HINTS: Partial<Record<BackendErrorKind, string>> = {
  offline: "opencode service start",
  provider_auth: "opencode auth login",
};

const ACTIONS: Record<PresentableKind, ErrorAction> = {
  offline: "retry",
  unauthorized: "connect",
  rate_limit: "chooseModel",
  provider_auth: "retry",
  provider_error: "retry",
  bad_response: "retry",
  incompatible: "retry",
  no_model: "chooseModel",
};

const PROVIDER_TITLES: Partial<Record<PresentableKind, MessageKey>> = {
  offline: "provider.offline.title",
  incompatible: "provider.incompatible.title",
  provider_auth: "provider.auth.title",
};

const PROVIDER_BODIES: Partial<Record<PresentableKind, Record<ErrorSurface, MessageKey>>> = {
  offline: { popup: "provider.offlineBody", card: "provider.offline" },
  incompatible: { popup: "provider.incompatible", card: "provider.incompatible" },
  provider_auth: { popup: "provider.auth", card: "provider.auth" },
};

export function resetClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(resolveLang(), {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

function rateLimitBody(surface: ErrorSurface, retryAfterMs: number | undefined, now: number) {
  if (retryAfterMs === undefined) {
    return t(surface === "popup" ? "popup.rateLimitUnknown" : "error.rate_limit_unknown");
  }
  const time = formatRetryAfter(retryAfterMs);
  const clock = resetClock(now + retryAfterMs);
  if (surface === "popup") return t(BODIES.rate_limit.popup, { time, clock });
  return t(BODIES.rate_limit.card, { time: `${time} (${t("selection.resetAt", { clock })})` });
}

export function describeError(
  kind: PresentableKind,
  surface: ErrorSurface,
  retryAfterMs?: number,
  now: number = Date.now(),
  backend: ConnectionKind = "opencode",
): ErrorPresentation {
  const provider = backend === "provider";
  const title = (provider && PROVIDER_TITLES[kind]) || TITLES[kind];
  const bodyKey = (provider && PROVIDER_BODIES[kind]?.[surface]) || BODIES[kind][surface];
  return {
    tone: kind === "rate_limit" ? "wn" : "er",
    title: t(title),
    body: kind === "rate_limit" ? rateLimitBody(surface, retryAfterMs, now) : t(bodyKey),
    hint: provider ? undefined : HINTS[kind],
    action: ACTIONS[kind],
  };
}
