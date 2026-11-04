import { randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { translate } from "./mock-translate";

export type ProviderMode = "ok" | "rate_limit" | "bad_key";

export type RecordedRequest = {
  method: string;
  path: string;
  authorization?: string;
  body?: unknown;
};

export type MockProvider = {
  url: string;
  key: string;
  requests: RecordedRequest[];
  stop(): Promise<void>;
};

const MODELS = {
  object: "list",
  data: [
    {
      id: "deepseek-flash",
      object: "model",
      owned_by: "deepseek",
      name: "DeepSeek-V4.1-Flash",
      context_window: 1048576,
      max_output_tokens: 393216,
      input_modalities: ["text", "image"],
      output_modalities: ["text"],
      effort: { supported_levels: ["low", "high", "max"], default_level: "high" },
    },
  ],
};

const UNAUTHORIZED = {
  error: {
    message: "Authentication Fails, Your api key: ****-bad is invalid",
    type: "authentication_error",
    param: null,
    code: "invalid_request_error",
  },
};

async function readBody(req: http.IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body;
}

export async function startMockProvider(opts: { mode?: ProviderMode } = {}): Promise<MockProvider> {
  const mode = opts.mode ?? "ok";
  const key = randomBytes(12).toString("hex");
  const expected = `Bearer ${key}`;
  const requests: RecordedRequest[] = [];

  const server = http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
      res.end(JSON.stringify(body));
    };

    const raw = req.method === "POST" ? await readBody(req) : "";
    requests.push({
      method: req.method ?? "GET",
      path: pathname,
      authorization: req.headers.authorization,
      ...(raw && { body: JSON.parse(raw) as unknown }),
    });

    if (mode === "bad_key" || req.headers.authorization !== expected) {
      return json(401, UNAUTHORIZED);
    }
    if (pathname === "/v1/models" && req.method === "GET") return json(200, MODELS);
    if (pathname === "/v1/chat/completions" && req.method === "POST") {
      if (mode === "rate_limit") {
        return json(
          429,
          { error: { message: "Rate limit reached", type: "rate_limit_error" } },
          { "retry-after": "2" },
        );
      }
      const { messages } = JSON.parse(raw) as { messages: { content: string }[] };
      const content = translate(messages.at(-1)?.content ?? "");
      return json(200, {
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      });
    }
    return json(404, {});
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/v1`,
    key,
    requests,
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
