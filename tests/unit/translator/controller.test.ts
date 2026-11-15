import { describe, expect, it, vi } from "vitest";
import type { SelectionResult } from "../../../lib/messaging/protocol";
import { MAX_EDITOR_TEXT } from "../../../lib/selection/limits";
import { builtinTemplate, DEFAULT_GLOBALS } from "../../../lib/settings/defaults";
import type { Template } from "../../../lib/settings/types";
import {
  createTranslator,
  translatorDefaults,
  translatorError,
} from "../../../lib/translator/controller";
import { textProblem } from "../../../lib/translator/input";
import { describeError } from "../../../lib/ui/errors";

function deferred() {
  let resolve!: (result: SelectionResult) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<SelectionResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup() {
  const translate = vi.fn<Parameters<typeof createTranslator>[1]["translate"]>();
  const cancel = vi.fn(async (_id: string) => {});
  const controller = createTranslator(
    { ...translatorDefaults(DEFAULT_GLOBALS, [builtinTemplate()]), text: "Hello" },
    { translate, cancel },
    vi.fn(),
  );
  return { controller, translate, cancel };
}

const answer = (text: string): SelectionResult => ({
  text,
  sourceLang: "auto",
  targetLang: "en",
  model: { providerID: "test", id: "test" },
});

describe("translator input", () => {
  it("counts UTF-16 units and refuses excess text without trimming", async () => {
    expect(textProblem("a".repeat(MAX_EDITOR_TEXT))).toBeNull();
    expect(textProblem("😀".repeat(MAX_EDITOR_TEXT / 2))).toBeNull();
    const text = `${"😀".repeat(MAX_EDITOR_TEXT / 2)}a`;
    expect(textProblem(text)).toBe("tooLong");
    const { controller, translate } = setup();
    controller.update({ text });
    await controller.translate();
    expect(translate).not.toHaveBeenCalled();
    expect(controller.state.text).toBe(text);
  });

  it.each(["", " \n\t "])("does not send empty input %j", async (text) => {
    expect(textProblem(text)).toBe("empty");
    const { controller, translate } = setup();
    controller.update({ text });
    await controller.translate();
    expect(translate).not.toHaveBeenCalled();
    expect(controller.state.running).toBe(false);
  });

  it("sends the full text at the limit with local languages and template", async () => {
    const { controller, translate } = setup();
    translate.mockResolvedValue(answer("Translated"));
    const text = ` ${"a".repeat(MAX_EDITOR_TEXT - 2)} `;
    controller.update({ text, sourceLang: "de", targetLang: "ru", templateId: "custom" });
    await controller.translate();
    expect(translate).toHaveBeenCalledWith({
      text,
      context: "",
      hostname: "",
      templateId: "custom",
      requestId: expect.any(String),
      editor: { sourceLang: "de", targetLang: "ru" },
    });
    expect(controller.state.result).toBe("Translated");
  });
});

describe("translator defaults", () => {
  const custom: Template = {
    id: "custom",
    name: "Custom",
    builtin: false,
    settings: { targetLang: "ja" },
  };
  it("uses the default template target and the global source language", () => {
    const globals = {
      ...DEFAULT_GLOBALS,
      sourceLang: "de",
      targetLang: "ru",
      defaultTemplateId: "custom",
    };
    expect(translatorDefaults(globals, [builtinTemplate(), custom])).toEqual({
      text: "",
      sourceLang: "de",
      targetLang: "ja",
      templateId: "custom",
    });
  });
  it("falls back to the builtin template for a removed default", () => {
    const globals = { ...DEFAULT_GLOBALS, defaultTemplateId: "removed" };
    expect(translatorDefaults(globals, [custom, builtinTemplate()]).templateId).toBe(
      builtinTemplate().id,
    );
    expect(translatorDefaults(globals, []).templateId).toBe(builtinTemplate().id);
  });

  it("moves the picker to a template target and sends a later manual choice", async () => {
    const { controller, translate } = setup();
    translate.mockResolvedValue(answer("Translated"));
    controller.chooseTemplate(custom);
    expect(controller.state.targetLang).toBe("ja");
    controller.update({ targetLang: "de" });
    controller.chooseTemplate(builtinTemplate());
    expect(controller.state.targetLang).toBe("de");
    await controller.translate();
    expect(translate.mock.calls[0]?.[0].editor?.targetLang).toBe("de");
  });
});

describe("translator request identity", () => {
  it("reuses the last result for unchanged inputs and after reverting edits", async () => {
    const { controller, translate } = setup();
    translate.mockResolvedValue({ ...answer("Saved"), truncated: false });
    await controller.translate();
    await controller.translate();
    for (const patch of [
      { text: "Hello!" },
      { sourceLang: "de" },
      { targetLang: "ja" },
      { templateId: "other" },
    ]) {
      const before = { ...controller.state };
      controller.update(patch);
      expect(controller.state.completion).toBeNull();
      controller.update({
        text: before.text,
        sourceLang: before.sourceLang,
        targetLang: before.targetLang,
        templateId: before.templateId,
      });
      expect(controller.state.result).toBe("Saved");
      expect(controller.state.completion).toBe("complete");
      await controller.translate();
    }
    expect(translate).toHaveBeenCalledTimes(1);
  });

  it("invalidates saved results when the selected template changes or is removed", async () => {
    const { controller, translate } = setup();
    const builtin = builtinTemplate();
    controller.refreshTemplates([builtin]);
    translate.mockResolvedValue(answer("First"));
    await controller.translate();
    controller.refreshTemplates([{ ...builtin, name: "Renamed" }]);
    expect(controller.state.result).toBe("First");
    const edited = { ...builtin, settings: { prePrompt: "New prompt", targetLang: "ja" } };
    controller.refreshTemplates([edited]);
    expect(controller.state.result).toBe("");
    expect(controller.state.targetLang).toBe("ja");
    await controller.translate();
    expect(translate).toHaveBeenCalledTimes(2);
    controller.refreshTemplates([{ ...edited, id: "replacement", builtin: true }]);
    expect(controller.state.templateId).toBe("replacement");
    expect(controller.state.result).toBe("");
  });

  it("cancels an in-flight request when its template changes", async () => {
    const { controller, translate } = setup();
    const template = builtinTemplate();
    controller.refreshTemplates([template]);
    const old = deferred();
    translate.mockReturnValue(old.promise);
    const pending = controller.translate();
    controller.refreshTemplates([{ ...template, settings: { prePrompt: "Changed" } }]);
    old.resolve(answer("Old prompt"));
    await pending;
    expect(controller.state.result).toBe("");
    expect(controller.state.running).toBe(false);
  });

  it("does not restore a result after its template was edited while another was selected", async () => {
    const { controller, translate } = setup();
    const builtin = builtinTemplate();
    const other = { ...builtin, id: "other" };
    controller.refreshTemplates([builtin, other]);
    translate.mockResolvedValue(answer("Old instructions"));
    await controller.translate();
    controller.chooseTemplate(other);
    const edited = { ...builtin, settings: { prePrompt: "New instructions" } };
    controller.refreshTemplates([edited, other]);
    controller.chooseTemplate(edited);
    expect(controller.state.result).toBe("");
    await controller.translate();
    expect(translate).toHaveBeenCalledTimes(2);
  });

  it("cancels the exact request and ignores its late answer", async () => {
    const { controller, translate, cancel } = setup();
    const old = deferred();
    translate.mockReturnValue(old.promise);
    const pending = controller.translate();
    expect(controller.state.running).toBe(true);
    controller.cancel();
    expect(cancel).toHaveBeenCalledWith(translate.mock.calls[0]?.[0].requestId);
    expect(controller.state.running).toBe(false);
    old.resolve(answer("Cancelled answer"));
    await pending;
    expect(controller.state.result).toBe("");
    expect(controller.state.error).toBeNull();
  });

  it("keeps the new request running when a superseded request fails", async () => {
    const { controller, translate, cancel } = setup();
    const old = deferred();
    const current = deferred();
    translate.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const first = controller.translate();
    const second = controller.translate();
    const firstId = translate.mock.calls[0]?.[0].requestId;
    expect(cancel).toHaveBeenCalledWith(firstId);
    expect(translate.mock.calls[1]?.[0].requestId).not.toBe(firstId);
    old.reject(new Error("late failure"));
    await first;
    expect(controller.state.running).toBe(true);
    expect(controller.state.error).toBeNull();
    current.resolve(answer("Current answer"));
    await second;
    expect(controller.state.result).toBe("Current answer");
  });

  it("ignores an older success after the new result is shown", async () => {
    const { controller, translate } = setup();
    const old = deferred();
    translate.mockReturnValueOnce(old.promise).mockResolvedValueOnce(answer("New"));
    const first = controller.translate();
    await controller.translate();
    old.resolve(answer("Old"));
    await first;
    expect(controller.state.result).toBe("New");
  });

  it("invalidates an in-flight request when the text or controls change", async () => {
    const { controller, translate } = setup();
    const old = deferred();
    translate.mockReturnValue(old.promise);
    const pending = controller.translate();
    controller.update({ targetLang: "ja" });
    old.resolve(answer("Old language"));
    await pending;
    expect(controller.state.result).toBe("");
    expect(controller.state.running).toBe(false);
  });
});

describe("translator errors", () => {
  it("shows a timeout and allows retrying the same text", async () => {
    const { controller, translate } = setup();
    translate
      .mockResolvedValueOnce({ error: "offline", timeout: true })
      .mockResolvedValueOnce(answer("Retried"));
    await controller.translate();
    expect(controller.state.error?.title).toContain("timed out");
    expect(controller.state.running).toBe(false);
    expect(controller.state.text).toBe("Hello");
    await controller.translate();
    expect(controller.state.result).toBe("Retried");
    expect(controller.state.error).toBeNull();
  });

  it.each([true, false, undefined])("preserves completion metadata %s", async (truncated) => {
    const { controller, translate } = setup();
    translate.mockResolvedValue({ ...answer("Partial"), truncated });
    await controller.translate();
    expect(controller.state.result).toBe("Partial");
    expect(controller.state.completion).toBe(
      truncated === undefined ? "unknown" : truncated ? "truncated" : "complete",
    );
    controller.update({ text: "Other" });
    expect(controller.state.completion).toBeNull();
  });
  it.each(["unauthorized", "provider_auth", "no_model"] as const)(
    "links %s to options",
    (error) => {
      expect(translatorError({ error })?.options).toBe(true);
    },
  );
  it("reuses the backend-specific error presentation and retry metadata", () => {
    expect(
      translatorError({ error: "provider_auth", backend: "provider", source: "Custom" }),
    ).toEqual({
      ...describeError("provider_auth", "card", undefined, undefined, "provider", "Custom"),
      options: true,
    });
    expect(translatorError({ error: "rate_limit", retryAfterMs: 120_000 })?.body).toContain("2");
    expect(translatorError({ error: "aborted" })).toBeNull();
  });
  it("presents a failed message transport without exposing exception text", async () => {
    const { controller, translate } = setup();
    translate.mockRejectedValue(new Error("private input"));
    await controller.translate();
    expect(controller.state.error?.title).toBe(describeError("offline", "card").title);
    expect(JSON.stringify(controller.state.error)).not.toContain("private input");
  });
});
