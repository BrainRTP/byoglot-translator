import type { Snapshot } from "./types.ts";

const STOP = new Set(
  (
    "a an the and or but if then else when while of to in on at by for with from into onto over under about as is are was were be been being " +
    "it its this that these those there here which who whom whose what where why how not no can could may might must shall should will would " +
    "do does did done has have had having you your we our they their them he she his her i me my one ones also only just more most other " +
    "some such than too very any all each every both either neither same so up out off via per using used use uses following example examples " +
    "see shows show note case cases way ways time times first last new well even still however therefore because since before after"
  ).split(" "),
);
const MAX_TERMS = 40;
const MAX_TITLES = 60;

const plain = (text: string) =>
  text
    .replace(/<x\d+\/>/g, " ")
    .replace(/<\/?x\d+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

export function glossaryCandidates(snapshot: Snapshot): string[] {
  const titles = new Set<string>();
  const counts = new Map<string, number>();
  for (const seg of snapshot.segments) {
    const text = plain(seg.text);
    const isTitle =
      text.length <= 80 &&
      !/<x\d+\/>/.test(seg.text) &&
      !/[.:;!?]$/.test(text) &&
      /\p{L}+[\s-]+\p{L}+/u.test(text);
    if (isTitle && titles.size < MAX_TITLES) titles.add(text);
    const words = (text.toLowerCase().match(/[a-z][a-z-]*[a-z]/g) ?? []).filter(
      (w) => w.length >= 4 && !STOP.has(w),
    );
    for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  const terms = [...counts.entries()]
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_TERMS)
    .map(([w]) => w);
  return [...titles, ...terms];
}

export function buildGlossaryPrompt(
  terms: string[],
  targetLang: string,
  languagePrompt: string | null,
): string {
  return [
    `You prepare a glossary for translating one web page into the language with code "${targetLang}".`,
    "For every item give the translation a developer would use on this page. Titles get a full natural translation. Keep in the original only what developers of that language keep untranslated (code, product names, established English words).",
    "Reply with only a JSON object that maps each item exactly as given to its translation.",
    languagePrompt?.trim() ? `LANGUAGE STYLE:\n${languagePrompt.trim()}` : "",
    `ITEMS:\n${JSON.stringify(terms)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function parseGlossary(raw: string): Record<string, string> {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return {};
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === "string"),
    );
  } catch {
    return {};
  }
}
