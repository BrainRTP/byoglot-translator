import { describe, expect, it } from "vitest";
import { isFatal } from "../../../lib/opencode/errors";
import type { BackendErrorKind } from "../../../lib/opencode/types";
import { PRESETS } from "../../../lib/provider/presets";
import { MAX_CONTEXT, MAX_SELECTION } from "../../../lib/selection/trigger";
import { builtinTemplate } from "../../../lib/settings/defaults";
import { FAVORITE, SELECTION_DEFAULT_EFFORT } from "../../../lib/settings/effective";
import { MAX_PROFILE_TEXT } from "../../../lib/settings/language-prompt";
import { LANGUAGE_CODES, LANGUAGE_NAMES } from "../../../lib/settings/languages";
import { buildPagePrompt } from "../../../lib/translate/prompt";
import { DEFAULT_LIMITS, GENERATE_TIMEOUT_MS } from "../../../lib/translate/service";
import { checkData } from "./harness";

const auto = "the source language (detect it)";
const kinds = [
  "offline",
  "unauthorized",
  "rate_limit",
  "provider_auth",
  "provider_error",
  "bad_response",
  "incompatible",
  "no_model",
  "aborted",
] as const satisfies BackendErrorKind[];
const allKinds = Object.fromEntries(kinds.map((kind) => [kind, true])) as Record<
  (typeof kinds)[number],
  true
> satisfies Record<BackendErrorKind, true>;

describe("contract data", () => {
  checkData("languages.json", {
    auto,
    codes: LANGUAGE_CODES,
    names: Object.fromEntries(LANGUAGE_CODES.map((code) => [code, LANGUAGE_NAMES[code]])),
  });
  checkData("presets.json", {
    presets: PRESETS,
    favoriteModel: FAVORITE,
    selectionDefaultEffort: SELECTION_DEFAULT_EFFORT,
  });
  checkData("limits.json", {
    ...DEFAULT_LIMITS,
    generateTimeoutMs: GENERATE_TIMEOUT_MS,
    maxProfileText: MAX_PROFILE_TEXT,
    maxSelection: MAX_SELECTION,
    maxContext: MAX_CONTEXT,
  });
  checkData("builtin-template.json", builtinTemplate());
  checkData("errors.json", { kinds: Object.keys(allKinds), fatal: kinds.filter(isFatal) });

  it("keeps the auto language name in the page prompt", () => {
    expect(
      buildPagePrompt({
        prePrompt: "",
        languagePrompt: "",
        sourceLang: "auto",
        targetLang: "ru",
        pageTitle: "",
        hostname: "example.com",
        segments: {},
      }),
    ).toContain(auto);
  });
});
