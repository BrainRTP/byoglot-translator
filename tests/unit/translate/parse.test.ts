import { describe, expect, it } from "vitest";
import { parsePageResponse, placeholderSignature } from "../../../lib/translate/parse";

const expected = {
  "1": "Agile teams",
  "2": "Read <x1>docs</x1> before deploy.",
  "3": "Sign in",
};

describe("parsePageResponse", () => {
  it("parses plain JSON", () => {
    const raw = JSON.stringify({
      "1": "Гибкие команды",
      "2": "Прочитайте <x1>docs</x1> перед деплоем.",
      "3": "Войти",
    });
    const r = parsePageResponse(raw, expected);
    expect(r.failed).toEqual([]);
    expect(r.ok["1"]).toBe("Гибкие команды");
    expect(r.ok["2"]).toBe("Прочитайте <x1>docs</x1> перед деплоем.");
  });

  it("keeps the letter yo in translations", () => {
    const raw =
      '{"1":"Agile (гибкая методология) для распределённых команд","2":"Прочитайте <x1>docs (документацию)</x1> перед деплоем (развёртыванием).","3":"Войти"}';
    const r = parsePageResponse(raw, expected);
    expect(r.failed).toEqual([]);
    expect(r.ok["1"]).toContain("распределённых");
  });

  it("parses JSON with spaces after colons", () => {
    const r = parsePageResponse('{"1": "a", "2": "b <x1>c</x1>", "3": "d"}', expected);
    expect(r.failed).toEqual([]);
  });

  it("parses JSON inside code fences", () => {
    const r = parsePageResponse('```json\n{"1":"a","2":"<x1>b</x1>","3":"c"}\n```', expected);
    expect(r.failed).toEqual([]);
    expect(Object.keys(r.ok)).toEqual(["1", "2", "3"]);
  });

  it("parses JSON preceded by prose", () => {
    const r = parsePageResponse(
      'Here is the translation: {"1":"a","2":"<x1>b</x1>","3":"c"} Hope it helps.',
      expected,
    );
    expect(r.failed).toEqual([]);
  });

  it("respects braces and escaped quotes inside strings", () => {
    const r = parsePageResponse(
      'Sure {"1":"a } b \\" { c","2":"<x1>b</x1>","3":"c"} trailing }',
      expected,
    );
    expect(r.failed).toEqual([]);
    expect(r.ok["1"]).toBe('a } b " { c');
  });

  it("skips earlier brace groups that are not the JSON answer", () => {
    const r = parsePageResponse('Note {x} then {"1":"a","2":"<x1>b</x1>","3":"c"}', expected);
    expect(r.failed).toEqual([]);
  });

  it("marks missing ids as failed", () => {
    const r = parsePageResponse('{"1":"a","3":"c"}', expected);
    expect(r.failed).toEqual(["2"]);
    expect(Object.keys(r.ok)).toEqual(["1", "3"]);
  });

  it("marks non-string values as failed", () => {
    const r = parsePageResponse('{"1":5,"2":"<x1>b</x1>","3":null}', expected);
    expect(r.failed.sort()).toEqual(["1", "3"]);
    expect(Object.keys(r.ok)).toEqual(["2"]);
  });

  it("fails only the id whose placeholder was dropped", () => {
    const r = parsePageResponse('{"1":"a","2":"Прочитайте docs","3":"c"}', expected);
    expect(r.failed).toEqual(["2"]);
    expect(Object.keys(r.ok).sort()).toEqual(["1", "3"]);
  });

  it("fails an id that gained placeholders the source did not have", () => {
    const r = parsePageResponse('{"1":"a <x1>b</x1>","2":"<x1>b</x1>","3":"c"}', expected);
    expect(r.failed).toEqual(["1"]);
  });

  it("ignores unknown ids", () => {
    const r = parsePageResponse('{"1":"a","2":"<x1>b</x1>","3":"c","9":"extra"}', expected);
    expect(r.failed).toEqual([]);
    expect(r.ok).not.toHaveProperty("9");
  });

  it("fails every id on invalid text without throwing", () => {
    const r = parsePageResponse("I cannot do that.", expected);
    expect(r.ok).toEqual({});
    expect(r.failed.sort()).toEqual(["1", "2", "3"]);
  });

  it("fails every id when the JSON is not an object", () => {
    expect(parsePageResponse('["a","b"]', expected).failed).toHaveLength(3);
    expect(parsePageResponse("null", expected).failed).toHaveLength(3);
  });
});

describe("placeholderSignature", () => {
  it("is a sorted multiset of tags", () => {
    expect(placeholderSignature("<x2/> a <x1>b</x1> <x1>c</x1>")).toBe(
      placeholderSignature("<x1>x</x1><x2/><x1>y</x1>"),
    );
    expect(placeholderSignature("<x1>b</x1>")).not.toBe(placeholderSignature("<x1>b"));
    expect(placeholderSignature("plain")).toBe("");
  });
});
