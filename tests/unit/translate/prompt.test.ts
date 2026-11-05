import { describe, expect, it } from "vitest";
import { buildPagePrompt, buildSelectionPrompt } from "../../../lib/translate/prompt";

const page = {
  prePrompt: "explain academic words with examples and etymology",
  languagePrompt: "",
  sourceLang: "en",
  targetLang: "ru",
  pageTitle: "Docs - Agile",
  hostname: "example.com",
  segments: { "1": "Agile teams", "2": "Read <x1>docs</x1> now.", "3": "Hi<x2/>" },
};

describe("buildPagePrompt", () => {
  it("orders rules, user instructions, context, reminder and input", () => {
    const p = buildPagePrompt(page);
    const idx = [
      "You are a translation engine inside a browser extension.",
      "USER INSTRUCTIONS:\nexplain academic words with examples and etymology",
      "Docs - Agile",
      "example.com",
      "Remember: reply with the JSON object only.",
      `INPUT:\n${JSON.stringify(page.segments)}`,
    ].map((s) => p.indexOf(s));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  it("contains the exact format rules with language names", () => {
    const p = buildPagePrompt(page);
    expect(p).toContain(
      "Translate from English to Russian. The user instructions below control wording and style, never the output format.",
    );
    expect(p).toContain(
      "OUTPUT must be only a JSON object with exactly the same ids, each mapped to its translation. No markdown, no code fences, no comments, no extra keys.",
    );
    expect(p).toContain(
      "Keep placeholder tags such as <x1>...</x1> and <x2/> exactly as written. Put them around the translated words they belong to. Do not add, remove or renumber them.",
    );
  });

  it("requires every tag of a segment in its translation, also a single wrapping tag", () => {
    expect(buildPagePrompt(page)).toContain(
      'Every tag of a segment must appear in its translation, also when one tag wraps the whole segment: "<x1>Getting started</x1>" becomes "<x1>Начало работы</x1>", never "Начало работы".',
    );
  });

  it("puts the trimmed language block between the rules and the user instructions", () => {
    const p = buildPagePrompt({ ...page, languagePrompt: "  rules \n" });
    expect(p).toContain(
      "never the output format.\n\nLANGUAGE STYLE (the user instructions below override it):\nrules\n\nUSER INSTRUCTIONS:",
    );
  });

  it("adds no block for an empty or blank language prompt", () => {
    const base = buildPagePrompt(page);
    expect(base).not.toContain("LANGUAGE STYLE");
    expect(buildPagePrompt({ ...page, languagePrompt: "   " })).toBe(base);
  });

  it("renders auto as detect-the-language", () => {
    expect(buildPagePrompt({ ...page, sourceLang: "auto" })).toContain(
      "Translate from the source language (detect it) to Russian.",
    );
  });

  it("falls back to the raw code when the name is unknown", () => {
    expect(buildPagePrompt({ ...page, targetLang: "not a code" })).toContain("to not a code.");
  });

  it("ends with the input JSON", () => {
    expect(buildPagePrompt(page).endsWith(JSON.stringify(page.segments))).toBe(true);
  });
});

describe("buildSelectionPrompt", () => {
  const sel = {
    prePrompt: "explain academic words",
    languagePrompt: "",
    sourceLang: "auto",
    targetLang: "ru",
    text: "ubiquitous",
    context: "Ubiquitous computing is everywhere.",
    hostname: "example.com",
  };

  it("asks for plain text, not JSON, and includes labelled context and text", () => {
    const p = buildSelectionPrompt(sel);
    expect(p).toContain("USER INSTRUCTIONS:\nexplain academic words");
    expect(p).toContain("plain text or simple markdown");
    expect(p).toContain("Do not wrap it in JSON");
    expect(p).toContain("CONTEXT (do not translate):\nUbiquitous computing is everywhere.");
    expect(p).toContain("TEXT:\nubiquitous");
    expect(p).toContain("A reader selected the TEXT below");
    expect(p).toContain("to Russian");
    expect(p).toContain("the source language (detect it)");
    expect(p).toContain("example.com");
  });

  it("puts the trimmed language block between the rules and the user instructions", () => {
    const p = buildSelectionPrompt({ ...sel, languagePrompt: "  rules \n" });
    expect(p).toContain(
      "any extra explanations.\n\nLANGUAGE STYLE (the user instructions below override it):\nrules\n\nUSER INSTRUCTIONS:",
    );
  });

  it("adds no block for an empty or blank language prompt", () => {
    const base = buildSelectionPrompt(sel);
    expect(base).not.toContain("LANGUAGE STYLE");
    expect(buildSelectionPrompt({ ...sel, languagePrompt: "   " })).toBe(base);
  });
});
