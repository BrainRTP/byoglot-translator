import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

export type MockMode = "ok" | "rate_limit" | "unauthorized";

export type RecordedRequest = {
  method: string;
  path: string;
  authorized: boolean;
  body?: unknown;
};

export type MockOpencode = {
  url: string;
  pairCode: string;
  token: string;
  stop(): Promise<void>;
  requests: RecordedRequest[];
};

const FIXTURES_DIR = path.join(import.meta.dirname, "fixtures");
const PREFIX = "[ru] ";
const MODEL = {
  providerID: "deepseek",
  id: "deepseek-flash",
  name: "deepseek-flash",
  variants: [{ id: "none" }],
  limit: { context: 100000, output: 8000 },
};

function translate(prompt: string): string {
  const input = prompt.lastIndexOf("\nINPUT:\n");
  if (input >= 0) {
    const segments = JSON.parse(prompt.slice(input + "\nINPUT:\n".length)) as Record<
      string,
      string
    >;
    return JSON.stringify(
      Object.fromEntries(Object.entries(segments).map(([id, text]) => [id, PREFIX + text])),
    );
  }
  const marker = "\n\nTEXT:\n";
  return PREFIX + prompt.slice(prompt.lastIndexOf(marker) + marker.length);
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body;
}

export async function startMockOpencode(opts: { mode?: MockMode } = {}): Promise<MockOpencode> {
  const mode = opts.mode ?? "ok";
  const token = randomBytes(12).toString("hex");
  const pairCode = randomBytes(8).toString("hex");
  const expected = `Basic ${Buffer.from(`opencode:${token}`).toString("base64")}`;
  const requests: RecordedRequest[] = [];
  let codeUsed = false;

  const server = http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    const json = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
    };

    if (pathname.startsWith("/fixtures/")) {
      const file = path.join(FIXTURES_DIR, path.basename(pathname));
      const html = await readFile(file, "utf8").catch(() => null);
      if (html === null) return json(404, {});
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(html);
      return;
    }

    const authorized = req.headers.authorization === expected;
    const raw = req.method === "POST" ? await readBody(req) : "";
    requests.push({
      method: req.method ?? "GET",
      path: pathname,
      authorized,
      ...(raw && { body: JSON.parse(raw) as unknown }),
    });

    if (pathname === `/auth/connect/${pairCode}`) {
      if (codeUsed) return json(401, {});
      codeUsed = true;
      return json(200, { token });
    }
    if (pathname.startsWith("/auth/connect/")) return json(401, {});
    if (!authorized) return json(401, {});

    if (pathname === "/api/info") return json(200, { version: "2.2.5" });
    if (pathname === "/api/model") return json(200, { data: [MODEL] });
    if (pathname === "/api/model/default") return json(200, { data: MODEL });
    if (pathname === "/api/experimental/generate/text" && req.method === "POST") {
      if (mode === "unauthorized") return json(401, {});
      if (mode === "rate_limit") {
        return json(429, {
          _tag: "ProviderRequestError",
          reason: "rate_limit",
          retryAfterMs: 5_040_000,
        });
      }
      const { prompt } = JSON.parse(raw) as { prompt: string };
      return json(200, { data: { text: translate(prompt) } });
    }
    return json(404, {});
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    pairCode,
    token,
    requests,
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
