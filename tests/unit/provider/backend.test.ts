import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ProviderData } from "../../../lib/connections/types";
import { BackendError } from "../../../lib/opencode/errors";
import { createProviderBackend } from "../../../lib/provider/backend";

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(join(process.cwd(), "tests/unit/provider/fixtures", name), "utf8"),
  );
}

const deepseek: ProviderData = {
  preset: "deepseek",
  name: "DeepSeek",
  baseUrl: "https://api.deepseek.com/",
  apiKey: "sk-test",
};
const model = { providerID: "deepseek", id: "deepseek-flash", variant: "high", connectionId: "c1" };

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function backendWith(
  impl: (url: string, init: RequestInit) => Promise<Response>,
  data: ProviderData = deepseek,
) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    impl(String(input), init ?? {}),
  );
  return { backend: createProviderBackend(data, fetchImpl as typeof fetch), fetchImpl };
}

function callAt(mock: { mock: { calls: unknown[][] } }, index: number) {
  const call = mock.mock.calls[index];
  if (!call) throw new Error(`no fetch call #${index}`);
  return { url: String(call[0]), init: (call[1] ?? {}) as RequestInit };
}

async function errorOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(BackendError);
  return error as BackendError;
}

const chatOk = { choices: [{ message: { content: "Привет" } }] };

describe("listModels", () => {
  it("maps the deepseek fixture", async () => {
    const { backend, fetchImpl } = backendWith(async () => json(fixture("deepseek-models.json")));
    const models = await backend.listModels();
    expect(callAt(fetchImpl, 0).url).toBe("https://api.deepseek.com/models");
    expect(callAt(fetchImpl, 0).init.method).toBe("GET");
    const flash = models.find((m) => m.id === "deepseek-flash");
    expect(flash).toEqual({
      providerID: "deepseek",
      id: "deepseek-flash",
      name: "DeepSeek-V4.1-Flash",
      variants: ["none", "low", "high", "max"],
      contextLimit: 1048576,
      outputLimit: 393216,
    });
  });

  it("falls back to id, context_length and zero limits", async () => {
    const data: ProviderData = { preset: "custom", name: "x", baseUrl: "http://h/v1", apiKey: "" };
    const { backend } = backendWith(
      async () => json({ data: [{ id: "a", context_length: 4096 }, { id: "b" }] }),
      data,
    );
    expect(await backend.listModels()).toEqual([
      {
        providerID: "custom",
        id: "a",
        name: "a",
        variants: ["none"],
        contextLimit: 4096,
        outputLimit: 0,
      },
      {
        providerID: "custom",
        id: "b",
        name: "b",
        variants: ["none"],
        contextLimit: 0,
        outputLimit: 0,
      },
    ]);
  });
});

describe("defaultModel and info", () => {
  it("deepseek picks deepseek-flash", async () => {
    const { backend } = backendWith(async () => json(fixture("deepseek-models.json")));
    expect((await backend.defaultModel())?.id).toBe("deepseek-flash");
  });

  it("others pick the first model, empty list gives null", async () => {
    const data: ProviderData = {
      preset: "ollama",
      name: "o",
      baseUrl: "http://localhost:11434/v1",
      apiKey: "",
    };
    const first = backendWith(async () => json({ data: [{ id: "x" }, { id: "y" }] }), data);
    expect((await first.backend.defaultModel())?.id).toBe("x");
    const empty = backendWith(async () => json({ data: [] }), data);
    expect(await empty.backend.defaultModel()).toBeNull();
  });

  it("info returns an empty version", async () => {
    const { backend } = backendWith(async () => json({ data: [] }));
    expect(await backend.info()).toEqual({ version: "" });
  });
});

describe("generate", () => {
  it("reports output-limit truncation to the editor while preserving the legacy string result", async () => {
    const { backend } = backendWith(async () =>
      json({ choices: [{ message: { content: "Partial" }, finish_reason: "length" }] }),
    );
    expect(await backend.generateWithMetadata?.("hi", model)).toEqual({
      text: "Partial",
      truncated: true,
    });
    expect(await backend.generate("hi", model)).toBe("Partial");
  });

  it("posts the chat request and returns the content", async () => {
    const { backend, fetchImpl } = backendWith(async () => json(fixture("deepseek-chat.json")));
    const text = await backend.generate("hi", model);
    expect(text).toContain("How can I help");
    const { url, init } = callAt(fetchImpl, 0);
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
    expect(JSON.parse(String(init.body))).toEqual({
      model: "deepseek-flash",
      messages: [{ role: "user", content: "hi" }],
      stream: false,
      reasoning_effort: "high",
    });
  });

  it("deepseek without variant sends reasoning_effort none", async () => {
    const { backend, fetchImpl } = backendWith(async () => json(chatOk));
    await backend.generate("hi", { providerID: "deepseek", id: "deepseek-flash" });
    expect(JSON.parse(String(callAt(fetchImpl, 0).init.body)).reasoning_effort).toBe("none");
  });

  it("openrouter high sends reasoning effort", async () => {
    const data: ProviderData = {
      preset: "openrouter",
      name: "or",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "k",
    };
    const { backend, fetchImpl } = backendWith(async () => json(chatOk), data);
    await backend.generate("hi", { providerID: "openrouter", id: "m", variant: "high" });
    expect(JSON.parse(String(callAt(fetchImpl, 0).init.body)).reasoning).toEqual({
      effort: "high",
    });
  });

  it("ollama without a key sends no authorization", async () => {
    const data: ProviderData = {
      preset: "ollama",
      name: "o",
      baseUrl: "http://localhost:11434/v1",
      apiKey: "",
    };
    const { backend, fetchImpl } = backendWith(async () => json(chatOk), data);
    await backend.generate("hi", { providerID: "ollama", id: "m" });
    const headers = callAt(fetchImpl, 0).init.headers as Record<string, string>;
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain("authorization");
  });

  it("empty content or missing field is bad_response", async () => {
    const empty = backendWith(async () => json({ choices: [{ message: { content: "" } }] }));
    expect((await errorOf(empty.backend.generate("hi", model))).kind).toBe("bad_response");
    const missing = backendWith(async () => json({ choices: [{ message: {} }] }));
    expect((await errorOf(missing.backend.generate("hi", model))).kind).toBe("bad_response");
  });
});

describe("errors", () => {
  const call = (impl: (url: string, init: RequestInit) => Promise<Response>) =>
    errorOf(backendWith(impl).backend.generate("hi", model));

  it("network failure is offline", async () => {
    const error = await call(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(error.kind).toBe("offline");
  });

  it("401 and 403 are provider_auth", async () => {
    const e401 = await call(async () => json(fixture("deepseek-401.json"), 401));
    expect(e401.kind).toBe("provider_auth");
    expect(e401.detail).toBeTruthy();
    expect((await call(async () => json({}, 403))).kind).toBe("provider_auth");
  });

  it("402 is provider_error with insufficient balance", async () => {
    const error = await call(async () => json({ error: { message: "x" } }, 402));
    expect(error.kind).toBe("provider_error");
    expect(error.detail).toBe("insufficient balance");
  });

  it("429 reads Retry-After in seconds", async () => {
    const error = await call(async () => json({}, 429, { "retry-after": "7" }));
    expect(error.kind).toBe("rate_limit");
    expect(error.retryAfterMs).toBe(7000);
  });

  it("429 reads Retry-After as an HTTP date", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const error = await call(async () =>
        json({}, 429, { "retry-after": "Thu, 01 Jan 2026 00:00:10 GMT" }),
      );
      expect(error.kind).toBe("rate_limit");
      expect(error.retryAfterMs).toBe(10000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a blank Retry-After", async () => {
    const error = await call(async () => json({}, 429, { "retry-after": "   " }));
    expect(error.retryAfterMs).toBeUndefined();
  });

  it("429 without the header has no retryAfterMs", async () => {
    const error = await call(async () => json({}, 429));
    expect(error.kind).toBe("rate_limit");
    expect(error.retryAfterMs).toBeUndefined();
  });

  it.each([400, 422, 500, 503])("%i is provider_error with the body message", async (status) => {
    const error = await call(async () => json({ error: { message: "boom" } }, status));
    expect(error.kind).toBe("provider_error");
    expect(error.detail).toBe("boom");
  });

  it("404 is incompatible", async () => {
    expect((await call(async () => json({}, 404))).kind).toBe("incompatible");
  });

  it("non-JSON body is incompatible", async () => {
    const error = await call(async () => new Response("<html>", { status: 200 }));
    expect(error.kind).toBe("incompatible");
  });

  it("wrong schema is incompatible", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const error = await call(async () => json({ nope: true }));
      expect(error.kind).toBe("incompatible");
      expect(error.detail).toBe("unexpected response shape");
      expect(warn).toHaveBeenCalledWith(
        "Provider response schema mismatch:",
        expect.stringContaining('"choices"'),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("abort is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { backend } = backendWith(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    expect((await errorOf(backend.generate("hi", model, controller.signal))).kind).toBe("aborted");
  });
});
