import type { ConnectionRecord, ConnectionView } from "./types";

export function originOf(url: string): string {
  return new URL(url).origin;
}

export function originPattern(url: string): string {
  const { protocol, hostname } = new URL(url);
  return `${protocol}//${hostname}/*`;
}

export function isLocalOrigin(origin: string): boolean {
  const host = new URL(origin).hostname;
  return host === "127.0.0.1" || host === "localhost";
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
  return list.some((rec) => {
    if (rec.id === exceptId) return false;
    try {
      return originOf(recordUrl(rec)) === origin;
    } catch {
      return false;
    }
  });
}
