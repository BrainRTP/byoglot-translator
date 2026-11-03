const TAG = /<(?:\/x\d+|x\d+\/?)>/g;

export function placeholderSignature(s: string): string {
  return (s.match(TAG) ?? []).sort().join("");
}

function balancedEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return -1;
}

function extractObject(raw: string): Record<string, unknown> | null {
  for (let s = raw.indexOf("{"); s >= 0; s = raw.indexOf("{", s + 1)) {
    const e = balancedEnd(raw, s);
    if (e < 0) continue;
    try {
      const v: unknown = JSON.parse(raw.slice(s, e + 1));
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {}
  }
  return null;
}

export function parsePageResponse(
  raw: string,
  expected: Record<string, string>,
): { ok: Record<string, string>; failed: string[] } {
  const obj = extractObject(raw);
  const ok: Record<string, string> = {};
  const failed: string[] = [];
  for (const [id, source] of Object.entries(expected)) {
    const v = obj && Object.hasOwn(obj, id) ? obj[id] : undefined;
    if (typeof v === "string" && placeholderSignature(v) === placeholderSignature(source)) {
      ok[id] = v;
    } else {
      failed.push(id);
    }
  }
  return { ok, failed };
}
