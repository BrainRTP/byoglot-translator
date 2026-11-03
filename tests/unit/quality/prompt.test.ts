import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPagePrompt, buildSelectionPrompt } from "../../../lib/translate/prompt";
import { buildPrompt, buildSelectionLabPrompt } from "../../quality/lib/prompt.ts";

const read = (p: string) => readFileSync(join(process.cwd(), "tests/quality/prompts", p), "utf8");
const plain = read("templates/plain.txt");
const page = {
  sourceLang: "auto",
  targetLang: "ru",
  pageTitle: "Resources :: Spring Framework",
  hostname: "docs.spring.io",
  segments: { b1: "The <x1/> Interface", b2: "Line\n\nwith blank" },
};

describe("buildPrompt", () => {
  it("reproduces the extension page prompt for frame v0 without a language prompt", () => {
    const lab = buildPrompt({
      frame: read("frame/page-v0.txt"),
      languagePrompt: null,
      template: plain,
      glossary: null,
      ...page,
    });
    expect(lab).toBe(buildPagePrompt({ prePrompt: plain, ...page }));
  });

  it("puts the language prompt before the user instructions", () => {
    const lab = buildPrompt({
      frame: read("frame/page-v0.txt"),
      languagePrompt: "Write like a human.",
      template: plain,
      glossary: null,
      ...page,
    });
    const lang = lab.indexOf(
      "LANGUAGE STYLE (the user instructions below override it):\nWrite like a human.",
    );
    expect(lang).toBeGreaterThan(0);
    expect(lang).toBeLessThan(lab.indexOf("USER INSTRUCTIONS:"));
  });

  it("puts the glossary before INPUT and does not re-expand braces from values", () => {
    const lab = buildPrompt({
      frame: read("frame/page-v0.txt"),
      languagePrompt: null,
      template: "Keep {{input}} literal",
      glossary: "bean = бин",
      ...page,
    });
    expect(lab.indexOf("GLOSSARY:\nbean = бин")).toBeLessThan(lab.indexOf("INPUT:"));
    expect(lab).toContain("Keep {{input}} literal");
  });
});

describe("buildSelectionLabPrompt", () => {
  it("reproduces the extension selection prompt for frame v0", () => {
    const sel = {
      sourceLang: "auto",
      targetLang: "ru",
      hostname: "docs.spring.io",
      text: "It wraps it.",
      context: "Para\n\ntext",
    };
    const lab = buildSelectionLabPrompt({
      frame: read("frame/selection-v0.txt"),
      languagePrompt: null,
      template: "",
      ...sel,
    });
    expect(lab).toBe(buildSelectionPrompt({ prePrompt: "", ...sel }));
  });
});
