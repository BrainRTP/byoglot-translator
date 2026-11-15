import type { ConnectionRecord, ConnectionView } from "./types";

export function originOf(url: string): string {
  return new URL(url).origin;
}

export function normalizeBaseUrl(raw: string): string {
  const url = new URL(raw);
  return (url.origin + url.pathname).replace(/\/+$/, "");
}

export function originPattern(url: string): string {
  const { protocol, hostname } = new URL(url);
  return `${protocol}//${hostname}/*`;
}

export function isLocalOrigin(origin: string): boolean {
  const host = new URL(origin).hostname;
  return host === "localhost" || /^127\.\d+\.\d+\.\d+$/.test(host) || host === "[::1]";
}

export function isLanOrigin(origin: string): boolean {
  const host = new URL(origin).hostname;
  if (host.endsWith(".local")) return true;
  if (host.startsWith("[")) {
    const first = Number.parseInt(host.slice(1, host.indexOf(":")), 16);
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
  }
  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || !octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    return false;
  }
  const [a, b = 0] = octets;
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

export function toView(rec: ConnectionRecord, activeId: string | null): ConnectionView {
  const active = rec.id === activeId;
  if (rec.kind === "opencode") {
    return {
      id: rec.id,
      kind: "opencode",
      name: "opencode",
      url: rec.url,
      hasKey: rec.password !== "",
      active,
    };
  }
  return {
    id: rec.id,
    kind: "provider",
    name: rec.name,
    url: rec.baseUrl,
    preset: rec.preset,
    hasKey: rec.apiKey !== "",
    active,
  };
}

function recordUrl(rec: ConnectionRecord): string {
  return rec.kind === "opencode" ? rec.url : rec.baseUrl;
}

export function originInUse(list: ConnectionRecord[], origin: string, exceptId?: string): boolean {
  const pattern = originPattern(origin);
  return list.some((rec) => {
    if (rec.id === exceptId) return false;
    try {
      return originPattern(recordUrl(rec)) === pattern;
    } catch {
      return false;
    }
  });
}
