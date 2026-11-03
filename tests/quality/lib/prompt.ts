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

function fill(frame: string, vars: Record<string, string>): string {
  return frame
    .trim()
    .split(/\n{2,}/)
    .map((section) => section.replace(/\{\{(\w+)\}\}/g, (m, key: string) => vars[key] ?? m))
    .filter((section) => section.trim() !== "")
    .join("\n\n");
}

const languageBlock = (p: string | null) =>
  p?.trim() ? `LANGUAGE STYLE (the user instructions below override it):\n${p.trim()}` : "";

type Common = {
  frame: string;
  languagePrompt: string | null;
  template: string;
  sourceLang: string;
  targetLang: string;
  hostname: string;
};

const commonVars = (i: Common) => ({
  source: languageName(i.sourceLang),
  target: languageName(i.targetLang),
  language: languageBlock(i.languagePrompt),
  instructions: i.template.trim() || "(none)",
  hostname: i.hostname,
});

export function buildPrompt(
  i: Common & { pageTitle: string; segments: Record<string, string>; glossary: string | null },
): string {
  return fill(i.frame, {
    ...commonVars(i),
    title: i.pageTitle,
    glossary: i.glossary?.trim() ? `GLOSSARY:\n${i.glossary.trim()}` : "",
    input: JSON.stringify(i.segments),
  });
}

export function buildSelectionLabPrompt(i: Common & { text: string; context: string }): string {
  return fill(i.frame, { ...commonVars(i), context: i.context, text: i.text });
}
