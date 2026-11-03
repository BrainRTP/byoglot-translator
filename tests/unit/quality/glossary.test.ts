import { describe, expect, it } from "vitest";
import { glossaryCandidates, parseGlossary } from "../../quality/lib/glossary.ts";
import type { Snapshot } from "../../quality/lib/types.ts";

const snapshot: Snapshot = {
  id: "t",
  url: "https://example.com",
  title: "T",
  hostname: "example.com",
  sourceLang: "en",
  takenAt: "2026-11-03",
  segments: [
    { id: "b1", text: "<x1>Ant-style Patterns</x1>", slots: {} },
    { id: "b2", text: "The bean uses a resolver. Every bean has a resolver.", slots: {} },
    {
      id: "b3",
      text: "A <x1/> bean asks the resolver for the <x2/> wildcard.",
      slots: { "1": "ClassPathResource", "2": "Resource" },
    },
    { id: "b4", text: "Java", slots: {} },
    { id: "b5", text: "The <x1/> Interface", slots: { "1": "Resource" } },
    { id: "b6", text: "Some of the most important methods are:", slots: {} },
  ],
  selections: [],
};

describe("glossaryCandidates", () => {
  it("collects short multi-word titles and repeated terms but no code", () => {
    const terms = glossaryCandidates(snapshot);
    expect(terms).toContain("Ant-style Patterns");
    expect(terms).toContain("bean");
    expect(terms).toContain("resolver");
    expect(terms).not.toContain("Java");
    expect(terms.join(" ")).not.toMatch(/ClassPathResource/);
    expect(terms).not.toContain("The Interface");
    expect(terms).not.toContain("Some of the most important methods are:");
  });
});

describe("parseGlossary", () => {
  it("reads a JSON object surrounded by text", () => {
    expect(parseGlossary('Here you go:\n{"bean": "бин", "n": 1}\nDone')).toEqual({ bean: "бин" });
  });
});
