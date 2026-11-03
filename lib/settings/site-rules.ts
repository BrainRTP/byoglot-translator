import type { SiteRule } from "./types";

const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/;

function normalize(s: string): string {
  const lower = s.trim().toLowerCase();
  return lower.endsWith(".") ? lower.slice(0, -1) : lower;
}

export function isValidPattern(p: string): boolean {
  const lower = p.trim().toLowerCase();
  const host = lower.startsWith("*.") ? lower.slice(2) : lower;
  return HOST.test(host);
}

export function matchSiteRule(hostname: string, rules: SiteRule[]): SiteRule | undefined {
  const host = normalize(hostname);
  let best: SiteRule | undefined;
  let bestLen = -1;
  let bestExact = false;
  for (const rule of rules) {
    if (!isValidPattern(rule.pattern)) continue;
    const pattern = rule.pattern.trim().toLowerCase();
    const wildcard = pattern.startsWith("*.");
    const base = wildcard ? pattern.slice(2) : pattern;
    const matches = wildcard ? host === base || host.endsWith(`.${base}`) : host === base;
    if (!matches) continue;
    const exact = !wildcard;
    if (base.length > bestLen || (base.length === bestLen && exact && !bestExact)) {
      best = rule;
      bestLen = base.length;
      bestExact = exact;
    }
  }
  return best;
}
