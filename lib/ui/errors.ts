import type { ConnectionKind } from "../connections/types";
import { formatRetryAfter, type MessageKey, resolveLang, t } from "../i18n";
import type { SelectionErrorKind } from "../messaging/protocol";

export type ErrorSurface = "popup" | "card";
export type ErrorAction = "retry" | "chooseModel" | "connect" | "settings";

export type ErrorPresentation = {
  tone: "er" | "wn";
  title: string;
  body: string;
  hint?: string;
  action: ErrorAction;
};

export type PresentableKind = Exclude<SelectionErrorKind, "aborted">;

const TITLES: Record<PresentableKind, MessageKey> = {
  offline: "error.offline.title",
  unauthorized: "error.unauthorized.title",
  https_required: "error.https_required.title",
  permission_required: "error.permission_required.title",
  missing_key: "error.missing_key.title",
  rate_limit: "error.rate_limit.title",
  provider_auth: "error.provider_auth.title",
  provider_error: "error.provider_error.title",
  bad_response: "error.bad_response.title",
  incompatible: "error.incompatible.title",
  no_model: "error.no_model.title",
  unknown_template: "error.unknown_template.title",
};

const BODIES: Record<PresentableKind, Record<ErrorSurface, MessageKey>> = {
  offline: { popup: "popup.offlineBody", card: "error.offline" },
  unauthorized: { popup: "error.unauthorized", card: "error.unauthorized" },
  https_required: { popup: "error.https_required", card: "error.https_required" },
  permission_required: { popup: "error.permission_required", card: "error.permission_required" },
  missing_key: { popup: "error.missing_key", card: "error.missing_key" },
  rate_limit: { popup: "popup.rateLimit", card: "error.rate_limit" },
  provider_auth: { popup: "popup.providerAuthBody", card: "error.provider_auth" },
  provider_error: { popup: "error.provider_error", card: "error.provider_error" },
  bad_response: { popup: "error.bad_response", card: "error.bad_response" },
  incompatible: { popup: "error.incompatible", card: "error.incompatible" },
  no_model: { popup: "error.no_model", card: "error.no_model" },
  unknown_template: { popup: "error.unknown_template", card: "error.unknown_template" },
};

const HINTS: Partial<Record<PresentableKind, string>> = {
  offline: "opencode service start",
  provider_auth: "opencode auth login",
};

const ACTIONS: Record<PresentableKind, ErrorAction> = {
  offline: "retry",
  unauthorized: "connect",
  https_required: "connect",
  permission_required: "connect",
  missing_key: "settings",
  rate_limit: "chooseModel",
  provider_auth: "retry",
  provider_error: "retry",
  bad_response: "retry",
  incompatible: "retry",
  no_model: "chooseModel",
  unknown_template: "retry",
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
  permission_required: {
    popup: "provider.permission_required",
    card: "provider.permission_required",
  },
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
  source?: string,
): ErrorPresentation {
  const provider = backend === "provider";
  const title = (provider && PROVIDER_TITLES[kind]) || TITLES[kind];
  const bodyKey = (provider && PROVIDER_BODIES[kind]?.[surface]) || BODIES[kind][surface];
  return {
    tone: kind === "rate_limit" ? "wn" : "er",
    title: source ? `${t(title)} (${source})` : t(title),
    body: kind === "rate_limit" ? rateLimitBody(surface, retryAfterMs, now) : t(bodyKey),
    hint: provider ? undefined : HINTS[kind],
    action:
      provider && (kind === "permission_required" || kind === "https_required")
        ? "settings"
        : ACTIONS[kind],
  };
}
