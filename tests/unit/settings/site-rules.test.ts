import { describe, expect, it } from "vitest";
import { isValidPattern, matchSiteRule } from "../../../lib/settings/site-rules";
import type { SiteRule } from "../../../lib/settings/types";

const rule = (id: string, pattern: string): SiteRule => ({ id, pattern, templateId: "t" });

describe("isValidPattern", () => {
  it.each(["example.com", "*.wikipedia.org", "localhost", "EXAMPLE.com"])("accepts %s", (p) => {
    expect(isValidPattern(p)).toBe(true);
  });

  it.each(["*.", "http://x", "a*b.com", "", "*", "a..b", ".a.com", "a.com/path"])(
    "rejects %s",
    (p) => {
      expect(isValidPattern(p)).toBe(false);
    },
  );
});

describe("matchSiteRule", () => {
  const rules = [rule("ex", "example.com"), rule("wiki", "*.wikipedia.org")];

  it("exact pattern matches only the exact host", () => {
    expect(matchSiteRule("example.com", rules)?.id).toBe("ex");
    expect(matchSiteRule("www.example.com", rules)).toBeUndefined();
    expect(matchSiteRule("notexample.com", rules)).toBeUndefined();
  });

  it("wildcard matches the apex and any subdomain depth", () => {
    expect(matchSiteRule("wikipedia.org", rules)?.id).toBe("wiki");
    expect(matchSiteRule("ru.m.wikipedia.org", rules)?.id).toBe("wiki");
    expect(matchSiteRule("evilwikipedia.org", rules)).toBeUndefined();
  });

  it("longer pattern wins", () => {
    const both = [rule("wiki", "*.wikipedia.org"), rule("ru", "ru.wikipedia.org")];
    expect(matchSiteRule("ru.wikipedia.org", both)?.id).toBe("ru");
    expect(matchSiteRule("en.wikipedia.org", both)?.id).toBe("wiki");
  });

  it("exact beats wildcard on equal length, regardless of order", () => {
    const a = [rule("w", "*.example.com"), rule("e", "example.com")];
    expect(matchSiteRule("example.com", a)?.id).toBe("e");
    expect(matchSiteRule("example.com", [...a].reverse())?.id).toBe("e");
  });

  it("is case-insensitive and ignores a trailing dot", () => {
    expect(matchSiteRule("Example.COM.", rules)?.id).toBe("ex");
    expect(matchSiteRule("example.com", [rule("x", "EXAMPLE.com")])?.id).toBe("x");
  });

  it("ignores invalid patterns", () => {
    expect(matchSiteRule("x", [rule("bad", "http://x")])).toBeUndefined();
  });
});
