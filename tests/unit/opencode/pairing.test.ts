import { describe, expect, it, vi } from "vitest";
import { pair, parsePairingLink } from "../../../lib/opencode/pairing";

const code = "gwTw8cvzypk1g0Ltb4ckkA";
const link = `http://127.0.0.1:49374/auth/connect/${code}`;

const pasted = `
  Open a link to connect. Links work once and expire in 5 minutes.

  ${link}

  Over SSH? Forward the port, then open the link on your machine:
  ssh -L 49374:127.0.0.1:49374 <host>
`;

describe("parsePairingLink", () => {
  it("does not take the origin from a redirect-style prefix", () => {
    const tricky = "https://evil.com/r?u=https://127.0.0.1:4096/auth/connect/ABC123";
    expect(parsePairingLink(tricky).origin).not.toBe("https://evil.com");
  });

  it("parses a bare link", () => {
    expect(parsePairingLink(link)).toEqual({ origin: "http://127.0.0.1:49374", code });
  });

  it("accepts surrounding whitespace", () => {
    expect(parsePairingLink(`  \n${link}\t\n`)).toEqual({ origin: "http://127.0.0.1:49374", code });
  });

  it("finds the link inside the whole opencode pair output", () => {
    expect(parsePairingLink(pasted)).toEqual({ origin: "http://127.0.0.1:49374", code });
  });

  it("accepts any http(s) origin", () => {
    expect(parsePairingLink("https://my-host.example.com:8443/auth/connect/abc_DEF-1")).toEqual({
      origin: "https://my-host.example.com:8443",
      code: "abc_DEF-1",
    });
  });

  it("rejects input without a connect link", () => {
    for (const input of [
      "",
      "hello",
      "http://127.0.0.1:49374/api/info",
      "ftp://h/auth/connect/x",
    ]) {
      expect(() => parsePairingLink(input)).toThrowError(
        expect.objectContaining({ name: "BackendError", kind: "bad_response" }),
      );
    }
  });
});

function callAt(mock: { mock: { calls: unknown[][] } }, index: number) {
  const call = mock.mock.calls[index];
  if (!call) throw new Error(`no fetch call #${index}`);
  return { url: String(call[0]), init: (call[1] ?? {}) as RequestInit };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("pair", () => {
  it("exchanges the code for a token and verifies it against /api/info", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/auth/connect/${code}`)) return json({ token: "secret-token" });
      if (url.endsWith("/api/info")) return json({ version: "2.2.5" });
      return new Response("", { status: 404 });
    });
    const conn = await pair(pasted, fetchImpl as unknown as typeof fetch);
    expect(conn).toEqual({
      url: "http://127.0.0.1:49374",
      username: "opencode",
      password: "secret-token",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(callAt(fetchImpl, 0).url).toBe(link);
    expect(new Headers(callAt(fetchImpl, 0).init.headers).get("authorization")).toBeNull();
    expect(callAt(fetchImpl, 1).url).toBe("http://127.0.0.1:49374/api/info");
    expect(new Headers(callAt(fetchImpl, 1).init.headers).get("authorization")).toBe(
      `Basic ${btoa("opencode:secret-token")}`,
    );
  });

  it("passes a timeout signal to the connect fetch and info", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
      String(input).endsWith("/api/info") ? json({ version: "2.2.5" }) : json({ token: "t" }),
    );
    await pair(link, fetchImpl as unknown as typeof fetch);
    expect(callAt(fetchImpl, 0).init.signal).toBeInstanceOf(AbortSignal);
    expect(callAt(fetchImpl, 1).init.signal).toBeInstanceOf(AbortSignal);
  });

  it("maps a timeout to offline", async () => {
    const fetchImpl = async () => {
      throw new DOMException("timed out", "TimeoutError");
    };
    await expect(pair(link, fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({
      kind: "offline",
    });
  });

  it("maps 401 on connect to unauthorized", async () => {
    const fetchImpl = vi.fn(async () => json({ _tag: "UnauthorizedError" }, 401));
    await expect(pair(link, fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({
      kind: "unauthorized",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps an unreachable server to offline", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(pair(link, fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({
      kind: "offline",
    });
  });

  it("maps a connect response without a token to incompatible", async () => {
    const fetchImpl = vi.fn(async () => json({ nope: true }));
    await expect(pair(link, fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({
      kind: "incompatible",
    });
  });

  it("rejects invalid input before any request", async () => {
    const fetchImpl = vi.fn();
    await expect(pair("garbage", fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({
      kind: "bad_response",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
