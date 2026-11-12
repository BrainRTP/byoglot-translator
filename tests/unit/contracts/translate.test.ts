import { languagePromptText } from "../../../lib/settings/language-prompt";
import type { ProfileOverrides } from "../../../lib/settings/types";
import { parsePageResponse } from "../../../lib/translate/parse";
import {
  buildPagePrompt,
  buildSelectionPrompt,
  buildTextPrompt,
} from "../../../lib/translate/prompt";
import { packBatches, type Segment } from "../../../lib/translate/service";
import { runContract } from "./harness";

type LanguageProfileInput = {
  languagePromptEnabled: boolean;
  languageProfile: string;
  targetLang: string;
  builtins: Record<string, string>;
  overrides: ProfileOverrides;
};

runContract("prompt-page", buildPagePrompt);
runContract("prompt-selection", buildSelectionPrompt);
runContract("prompt-text", buildTextPrompt);
runContract("parse-page", (i: { raw: string; expected: Record<string, string> }) =>
  parsePageResponse(i.raw, i.expected),
);
runContract("pack-batches", (i: { segments: Segment[]; maxBlocks: number; maxChars: number }) =>
  packBatches(i.segments, {
    maxBlocks: i.maxBlocks,
    maxChars: i.maxChars,
    concurrency: 1,
  }).map((batch) => batch.map((segment) => segment.id)),
);
runContract("language-profile", (i: LanguageProfileInput) =>
  languagePromptText(i, i.targetLang, new Map(Object.entries(i.builtins)), i.overrides),
);
