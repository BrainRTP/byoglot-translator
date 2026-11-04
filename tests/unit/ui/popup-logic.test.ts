import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setUiLang } from "../../../lib/i18n";
import type { PageState, TabView } from "../../../lib/messaging/protocol";
import type { ModelInfo } from "../../../lib/opencode/types";
import {
  errorView,
  isTranslatableUrl,
  mainAction,
  modelWarning,
  pageFailure,
  pageHostname,
  progressView,
  variantFor,
} from "../../../lib/ui/popup-logic";

beforeEach(() => setUiLang("en"));
afterEach(() => setUiLang("auto"));

const page = (over: Partial<PageState>): PageState => ({
  state: "idle",
  done: 0,
  total: 0,
  failed: 0,
  ...over,
});

describe("isTranslatableUrl", () => {
  it("accepts http and https only", () => {
    expect(isTranslatableUrl("https://en.wikipedia.org/wiki/X")).toBe(true);
    expect(isTranslatableUrl("http://localhost:3000/")).toBe(true);
    expect(isTranslatableUrl("chrome://extensions")).toBe(false);
    expect(isTranslatableUrl("about:blank")).toBe(false);
    expect(isTranslatableUrl("file:///tmp/a.html")).toBe(false);
    expect(isTranslatableUrl(undefined)).toBe(false);
  });
});

describe("pageHostname", () => {
  it("returns the hostname or an empty string", () => {
    expect(pageHostname("https://en.wikipedia.org:8443/x")).toBe("en.wikipedia.org");
    expect(pageHostname("nonsense")).toBe("");
    expect(pageHostname(undefined)).toBe("");
  });
});

describe("errorView", () => {
  it("uses the popup wording and hides aborted", () => {
    expect(errorView("offline")?.body).toContain("Retry");
    expect(errorView("no_model")?.action).toBe("chooseModel");
    expect(errorView("aborted")).toBeNull();
  });

  it("uses provider wording for a provider backend", () => {
    const v = errorView("offline", undefined, Date.now(), "provider");
    expect(JSON.stringify(v)).not.toMatch(/opencode/i);
    expect(v?.hint).toBeUndefined();
  });
});

describe("mainAction", () => {
  it("translates when idle and shows the original otherwise", () => {
    expect(mainAction(page({ state: "idle" }))).toBe("translate");
    expect(mainAction(page({ state: "translating" }))).toBe("showOriginal");
    expect(mainAction(page({ state: "translated" }))).toBe("showOriginal");
  });

  it("an error keeps the original action only when something was translated", () => {
    expect(mainAction(page({ state: "error", done: 34, total: 120 }))).toBe("showOriginal");
    expect(mainAction(page({ state: "error" }))).toBe("translate");
  });
});

describe("progressView", () => {
  it("shows progress while translating", () => {
    expect(progressView(page({ state: "translating", done: 34, total: 120 }))).toEqual({
      percent: 28,
      paused: false,
      stoppable: true,
    });
  });

  it("shows a paused bar after an error with progress", () => {
    expect(progressView(page({ state: "error", done: 34, total: 120 }))).toEqual({
      percent: 28,
      paused: true,
      stoppable: false,
    });
  });

  it("hides when idle, translated or empty", () => {
    expect(progressView(page({ state: "idle" }))).toBeNull();
    expect(progressView(page({ state: "translated", done: 5, total: 5 }))).toBeNull();
    expect(progressView(page({ state: "error", done: 0, total: 0 }))).toBeNull();
  });

  it("a translating page with no blocks yet has 0 percent", () => {
    expect(progressView(page({ state: "translating" }))?.percent).toBe(0);
  });
});

describe("variantFor", () => {
  const model = (variants: string[]): ModelInfo => ({
    providerID: "p",
    id: "m",
    name: "m",
    variants,
    contextLimit: 1,
    outputLimit: 1,
  });

  it("keeps a variant the new model supports", () => {
    expect(variantFor(model(["none", "low"]), "low")).toBe("low");
  });

  it("falls back to none, then to the default", () => {
    expect(variantFor(model(["none", "high"]), "low")).toBe("none");
    expect(variantFor(model(["high"]), "low")).toBeUndefined();
    expect(variantFor(model([]), "low")).toBeUndefined();
  });
});

describe("modelWarning", () => {
  const view = (pageModel: TabView["pageModel"], stored: TabView["settings"]["pageModel"]) =>
    ({ pageModel, settings: { pageModel: stored } }) as TabView;

  it("is null when the model is present", () => {
    const m = { providerID: "p", id: "a" };
    expect(modelWarning(view({ model: m, missing: false }, m))).toBeNull();
  });

  it("names the missing and the fallback model", () => {
    const w = modelWarning(
      view(
        { model: { providerID: "ds", id: "deepseek-flash" }, missing: true },
        { providerID: "ds", id: "deepseek-v4" },
      ),
    );
    expect(w).toBe(
      "Model deepseek-v4 from the template is not available in opencode. Using deepseek-flash.",
    );
  });

  it("reports an unavailable effort when only the variant is missing", () => {
    const w = modelWarning(
      view(
        { model: { providerID: "ds", id: "flash" }, missing: true },
        { providerID: "ds", id: "flash", variant: "max" },
      ),
    );
    expect(w).toBe('Effort "max" is not available for flash. Using the default.');
  });
});

describe("pageFailure", () => {
  const failed = (kind: "rate_limit" | "provider_auth" | "unauthorized" | "aborted") =>
    page({ state: "error", done: 34, total: 120, error: { kind, retryAfterMs: 60_000 } });

  it("takes the backend from the page error", () => {
    const f = pageFailure(
      page({ state: "error", done: 1, total: 5, error: { kind: "offline", backend: "provider" } }),
      false,
    );
    expect(JSON.stringify(f.error)).not.toMatch(/opencode/i);
  });

  it("shows nothing when the page is not in error", () => {
    expect(pageFailure(page({ state: "translating" }), false)).toEqual({
      error: null,
      showResume: false,
    });
  });

  it("rate_limit keeps the banner and offers a separate resume", () => {
    const f = pageFailure(failed("rate_limit"), false);
    expect(f.error?.action).toBe("chooseModel");
    expect(f.showResume).toBe(true);
  });

  it("provider_auth uses the banner retry as the resume", () => {
    const f = pageFailure(failed("provider_auth"), false);
    expect(f.error?.action).toBe("retry");
    expect(f.showResume).toBe(false);
  });

  it("unauthorized offers no resume", () => {
    expect(pageFailure(failed("unauthorized"), false).showResume).toBe(false);
  });

  it("a dismissed banner is replaced by a plain resume", () => {
    expect(pageFailure(failed("rate_limit"), true)).toEqual({ error: null, showResume: true });
    expect(pageFailure(failed("provider_auth"), true)).toEqual({ error: null, showResume: true });
  });

  it("aborted has no banner but can be resumed", () => {
    expect(pageFailure(failed("aborted"), false)).toEqual({ error: null, showResume: true });
  });
});
