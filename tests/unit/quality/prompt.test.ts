import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPagePrompt, buildSelectionPrompt } from "../../../lib/translate/prompt";
import { readPrompt } from "../../quality/lib/paths.ts";
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

describe("readPrompt", () => {
  it("reads a built-in profile by profile:<id>", () => {
    expect(readPrompt("profile:ru")).toBe(
      readFileSync(join(process.cwd(), "lib/translate/profiles/ru.md"), "utf8"),
    );
  });

  it("still reads prompt files relative to the prompts directory", () => {
    expect(readPrompt("frame/page-v1.txt")).toBe(read("frame/page-v1.txt"));
  });
});

describe("frame page-v1", () => {
  it("is page-v0 with only line 4 replaced by line 4 of page-c2", () => {
    const v0 = read("frame/page-v0.txt").split("\n");
    const v1 = read("frame/page-v1.txt").split("\n");
    const c2 = read("frame/page-c2.txt").split("\n");
    expect(v1[3]).toBe(c2[3]);
    expect(v1.filter((_, n) => n !== 3)).toEqual(v0.filter((_, n) => n !== 3));
  });
});

describe("buildPrompt", () => {
  it("reproduces the extension page prompt for frame v1 without a language prompt", () => {
    const lab = buildPrompt({
      frame: read("frame/page-v1.txt"),
      languagePrompt: null,
      template: plain,
      glossary: null,
      ...page,
    });
    expect(lab).toBe(buildPagePrompt({ prePrompt: plain, languagePrompt: "", ...page }));
  });

  it("reproduces the extension page prompt for frame v1 with a profile", () => {
    const languagePrompt = readPrompt("profile:ru");
    const lab = buildPrompt({
      frame: read("frame/page-v1.txt"),
      languagePrompt,
      template: plain,
      glossary: null,
      ...page,
    });
    expect(lab).toBe(buildPagePrompt({ prePrompt: plain, languagePrompt, ...page }));
    expect(lab).toContain("LANGUAGE STYLE (the user instructions below override it):\n");
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
  const sel = {
    sourceLang: "auto",
    targetLang: "ru",
    hostname: "docs.spring.io",
    text: "It wraps it.",
    context: "Para\n\ntext",
  };

  it("reproduces the extension selection prompt for frame v0", () => {
    const lab = buildSelectionLabPrompt({
      frame: read("frame/selection-v0.txt"),
      languagePrompt: null,
      template: "",
      ...sel,
    });
    expect(lab).toBe(buildSelectionPrompt({ prePrompt: "", languagePrompt: "", ...sel }));
  });

  it("reproduces the extension selection prompt for frame v0 with a profile", () => {
    const languagePrompt = readPrompt("profile:ru");
    const lab = buildSelectionLabPrompt({
      frame: read("frame/selection-v0.txt"),
      languagePrompt,
      template: plain,
      ...sel,
    });
    expect(lab).toBe(buildSelectionPrompt({ prePrompt: plain, languagePrompt, ...sel }));
    expect(lab).toContain("LANGUAGE STYLE (the user instructions below override it):\n");
  });
});
