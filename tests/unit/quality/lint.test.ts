import { describe, expect, it } from "vitest";
import { lint } from "../../quality/lib/lint.ts";
import type { Row, Snapshot } from "../../quality/lib/types.ts";

const snapshot: Snapshot = {
  id: "t",
  url: "https://example.com",
  title: "Resources :: Spring Framework",
  hostname: "example.com",
  sourceLang: "en",
  takenAt: "2026-11-03",
  segments: [],
  selections: [],
};
const words = (n: number) => Array.from({ length: n }, () => "слово").join(" ");

describe("lint", () => {
  it("counts bureaucratic markers per 1000 words", () => {
    const rows: Row[] = [{ id: "b1", source: "x", translation: `Это является ${words(98)}.` }];
    expect(lint(rows, snapshot).markersPer1000["явля"]).toBe(10);
  });

  it("reports English phrases left outside code", () => {
    const rows: Row[] = [
      { id: "b1", source: "See Using <x1/>", translation: "См. See Using <x1/>" },
    ];
    expect(lint(rows, snapshot).englishLeft).toEqual([{ id: "b1", phrase: "See Using" }]);
  });

  it("does not report names from the page title", () => {
    const rows: Row[] = [{ id: "b1", source: "Spring Framework", translation: "Spring Framework" }];
    expect(lint(rows, snapshot).englishLeft).toEqual([]);
  });

  it("lists untranslated blocks as final failures", () => {
    const rows: Row[] = [
      { id: "b1", source: "x", translation: "икс" },
      { id: "b2", source: "y", translation: null },
    ];
    expect(lint(rows, snapshot).finalFailed).toEqual(["b2"]);
  });

  it("collects every rendering of a tracked term", () => {
    const rows: Row[] = [
      { id: "b1", source: "the bean", translation: "бин" },
      { id: "b2", source: "a bean", translation: "bean-компонент" },
    ];
    expect(lint(rows, snapshot).termVariants.bean?.sort()).toEqual(["bean-компонент", "бин"]);
  });

  it("counts the dotted e letter", () => {
    const rows: Row[] = [{ id: "b1", source: "x", translation: "е\u0451 \u0451" }];
    expect(lint(rows, snapshot).yoCount).toBe(2);
  });
});
