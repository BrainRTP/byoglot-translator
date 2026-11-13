import { t } from "../i18n";
import type { ProtocolMap, SelectionResult } from "../messaging/protocol";
import { BUILTIN_TEMPLATE_ID, builtinTemplate } from "../settings/defaults";
import type { GlobalSettings, Template } from "../settings/types";
import { describeError, type ErrorPresentation } from "../ui/errors";
import { textProblem } from "./input";

export type TranslatorInput = {
  text: string;
  sourceLang: string;
  targetLang: string;
  templateId: string;
};

export type TranslatorState = TranslatorInput & {
  running: boolean;
  result: string;
  completion: "complete" | "truncated" | "unknown" | null;
  error: (ErrorPresentation & { options: boolean }) | null;
};

export function translatorDefaults(
  globals: GlobalSettings,
  templates: Template[],
): TranslatorInput {
  const template =
    templates.find((t) => t.id === globals.defaultTemplateId) ??
    templates.find((t) => t.id === BUILTIN_TEMPLATE_ID) ??
    builtinTemplate();
  return {
    text: "",
    sourceLang: globals.sourceLang,
    targetLang: template.settings.targetLang ?? globals.targetLang,
    templateId: template.id,
  };
}

export function translatorError(result: Extract<SelectionResult, { error: string }>) {
  if (result.error === "aborted") return null;
  return {
    ...describeError(
      result.error,
      "card",
      result.retryAfterMs,
      undefined,
      result.backend,
      result.source,
    ),
    ...(result.timeout && {
      title: t("translator.timeout.title"),
      body: t("translator.timeout"),
      hint: undefined,
    }),
    options:
      !!result.timeout || ["unauthorized", "provider_auth", "no_model"].includes(result.error),
  };
}

export function createTranslator(
  initial: TranslatorInput,
  deps: {
    translate(input: Parameters<ProtocolMap["translateSelection"]>[0]): Promise<SelectionResult>;
    cancel(requestId: string): Promise<void>;
  },
  onChange: (state: TranslatorState) => void,
) {
  let state: TranslatorState = {
    ...initial,
    running: false,
    result: "",
    completion: null,
    error: null,
  };
  let active: string | null = null;

  function publish(patch: Partial<TranslatorState>) {
    state = { ...state, ...patch };
    onChange(state);
  }

  function cancel() {
    const id = active;
    active = null;
    if (id) void deps.cancel(id).catch(() => {});
    publish({ running: false });
  }

  function update(patch: Partial<TranslatorInput>) {
    cancel();
    publish({ ...patch, result: "", completion: null, error: null });
  }

  return {
    get state() {
      return state;
    },
    update,
    chooseTemplate(template: Template | undefined) {
      if (template)
        update({
          templateId: template.id,
          targetLang: template.settings.targetLang ?? state.targetLang,
        });
    },
    cancel,
    async translate() {
      cancel();
      if (textProblem(state.text)) return;
      const requestId = crypto.randomUUID();
      active = requestId;
      publish({ running: true, result: "", completion: null, error: null });
      try {
        const result = await deps.translate({
          text: state.text,
          context: "",
          hostname: "",
          templateId: state.templateId,
          requestId,
          editor: { sourceLang: state.sourceLang, targetLang: state.targetLang },
        });
        if (active !== requestId) return;
        publish(
          "text" in result
            ? {
                result: result.text,
                completion:
                  result.truncated === undefined
                    ? "unknown"
                    : result.truncated
                      ? "truncated"
                      : "complete",
              }
            : { error: translatorError(result) },
        );
      } catch {
        if (active === requestId) publish({ error: translatorError({ error: "offline" }) });
      } finally {
        if (active === requestId) {
          active = null;
          publish({ running: false });
        }
      }
    },
  };
}
