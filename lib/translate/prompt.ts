import { LANGUAGE_NAMES } from "../settings/languages";

const AUTO_SOURCE = "the source language (detect it)";

function languageName(code: string): string {
  if (code === "auto") return AUTO_SOURCE;
  return Object.hasOwn(LANGUAGE_NAMES, code) ? (LANGUAGE_NAMES[code] ?? code) : code;
}

const LANGUAGE_HEADER = "LANGUAGE STYLE (the user instructions below override it):";

const languageBlock = (text: string) => (text.trim() ? [`${LANGUAGE_HEADER}\n${text.trim()}`] : []);

const userInstructions = (prePrompt: string) =>
  `USER INSTRUCTIONS:\n${prePrompt.trim() || "(none)"}`;

export function buildPagePrompt(i: {
  prePrompt: string;
  languagePrompt: string;
  sourceLang: string;
  targetLang: string;
  pageTitle: string;
  hostname: string;
  segments: Record<string, string>;
}): string {
  return [
    [
      "You are a translation engine inside a browser extension.",
      "INPUT is a JSON object that maps segment ids to source text.",
      "OUTPUT must be only a JSON object with exactly the same ids, each mapped to its translation. No markdown, no code fences, no comments, no extra keys.",
      'Keep placeholder tags such as <x1>...</x1> and <x2/> exactly as written. Put them around the translated words they belong to. Do not add, remove or renumber them. Every tag of a segment must appear in its translation, also when one tag wraps the whole segment: "<x1>Getting started</x1>" becomes "<x1>Начало работы</x1>", never "Начало работы".',
      `Translate from ${languageName(i.sourceLang)} to ${languageName(i.targetLang)}. The user instructions below control wording and style, never the output format.`,
    ].join("\n"),
    ...languageBlock(i.languagePrompt),
    userInstructions(i.prePrompt),
    `Page: ${JSON.stringify(i.pageTitle)} on ${i.hostname}.`,
    "Remember: reply with the JSON object only.",
    `INPUT:\n${JSON.stringify(i.segments)}`,
  ].join("\n\n");
}

const FORM_RULE =
  "The TEXT can be a single word, a phrase, a sentence or a paragraph. Translate exactly this fragment and keep its form: a term stays a term, a phrase stays a phrase, a sentence stays a sentence. Start with a lowercase letter unless the fragment starts a sentence or is a name.";
const OUTPUT_RULE =
  "The answer is shown to a human as plain text or simple markdown. Do not wrap it in JSON or code fences, do not repeat the source text and do not add notes unless the user instructions ask for them. The user instructions below control wording, style and any extra explanations.";

export function buildSelectionPrompt(i: {
  prePrompt: string;
  languagePrompt: string;
  sourceLang: string;
  targetLang: string;
  text: string;
  context: string;
  hostname: string;
}): string {
  return [
    [
      "You are a translation assistant inside a browser extension.",
      `A reader selected the TEXT below on a web page and wants to understand it. Translate the TEXT from ${languageName(i.sourceLang)} to ${languageName(i.targetLang)}.`,
      FORM_RULE,
      "CONTEXT is the text around the selection. Do not translate it, but use it to pick the meaning that fits this page, especially for short terms.",
      OUTPUT_RULE,
    ].join("\n"),
    ...languageBlock(i.languagePrompt),
    userInstructions(i.prePrompt),
    `The text comes from a page on ${i.hostname}.`,
    `CONTEXT (do not translate):\n${i.context}`,
    `TEXT:\n${i.text}`,
  ].join("\n\n");
}

export function buildTextPrompt(i: {
  prePrompt: string;
  languagePrompt: string;
  sourceLang: string;
  targetLang: string;
  text: string;
  context: string;
  appName: string;
}): string {
  const hasContext = i.context.trim().length > 0;
  return [
    [
      "You are a translation assistant.",
      `A reader selected the TEXT below and wants to understand it. Translate the TEXT from ${languageName(i.sourceLang)} to ${languageName(i.targetLang)}.`,
      FORM_RULE,
      ...(hasContext
        ? [
            "CONTEXT is the text around the selection. Do not translate it, but use it to pick the meaning that fits, especially for short terms.",
          ]
        : []),
      OUTPUT_RULE,
    ].join("\n"),
    ...languageBlock(i.languagePrompt),
    userInstructions(i.prePrompt),
    ...(i.appName.trim() ? [`The text comes from the app ${i.appName.trim()}.`] : []),
    ...(hasContext ? [`CONTEXT (do not translate):\n${i.context}`] : []),
    `TEXT:\n${i.text}`,
  ].join("\n\n");
}
