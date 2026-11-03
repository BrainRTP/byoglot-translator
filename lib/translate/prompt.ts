const AUTO_SOURCE = "the source language (detect it)";

function languageName(code: string): string {
  if (code === "auto") return AUTO_SOURCE;
  try {
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(code);
    return name && name !== code ? name : code;
  } catch {
    return code;
  }
}

const userInstructions = (prePrompt: string) =>
  `USER INSTRUCTIONS:\n${prePrompt.trim() || "(none)"}`;

export function buildPagePrompt(i: {
  prePrompt: string;
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
      "Keep placeholder tags such as <x1>...</x1> and <x2/> exactly as written. Put them around the translated words they belong to. Do not add, remove or renumber them.",
      `Translate from ${languageName(i.sourceLang)} to ${languageName(i.targetLang)}. The user instructions below control wording and style, never the output format.`,
    ].join("\n"),
    userInstructions(i.prePrompt),
    `Page: "${i.pageTitle}" on ${i.hostname}.`,
    "Remember: reply with the JSON object only.",
    `INPUT:\n${JSON.stringify(i.segments)}`,
  ].join("\n\n");
}

export function buildSelectionPrompt(i: {
  prePrompt: string;
  sourceLang: string;
  targetLang: string;
  text: string;
  context: string;
  hostname: string;
}): string {
  return [
    [
      "You are a translation assistant inside a browser extension.",
      `Translate the TEXT below from ${languageName(i.sourceLang)} to ${languageName(i.targetLang)}.`,
      "The answer is shown to a human as plain text or simple markdown. Do not wrap the answer in JSON or code fences. The user instructions below control wording, style and any extra explanations.",
    ].join("\n"),
    userInstructions(i.prePrompt),
    `The text comes from a page on ${i.hostname}.`,
    `CONTEXT (do not translate):\n${i.context}`,
    `TEXT:\n${i.text}`,
  ].join("\n\n");
}
