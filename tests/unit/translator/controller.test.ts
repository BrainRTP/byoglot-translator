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
  it("uses global languages and the default template without changing saved settings", () => {
    const globals = {
      ...DEFAULT_GLOBALS,
      sourceLang: "de",
      targetLang: "ru",
      defaultTemplateId: "custom",
    };
    const before = structuredClone(globals);
    expect(translatorDefaults(globals, [builtinTemplate(), custom])).toEqual({
      text: "",
      sourceLang: "de",
      targetLang: "ru",
      templateId: "custom",
    });
    expect(globals).toEqual(before);
  });
  it("falls back to the builtin template for a removed default", () => {
    const globals = { ...DEFAULT_GLOBALS, defaultTemplateId: "removed" };
    expect(translatorDefaults(globals, [custom, builtinTemplate()]).templateId).toBe(
      builtinTemplate().id,
    );
    expect(translatorDefaults(globals, []).templateId).toBe(builtinTemplate().id);
  });
});

describe("translator request identity", () => {
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
