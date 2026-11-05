import { describe, expect, it, vi } from "vitest";
import { createOpencodeBackend } from "../../../lib/opencode/backend";
import { BackendError, isFatal } from "../../../lib/opencode/errors";

const conn = { url: "http://127.0.0.1:49374", username: "opencode", password: "tok" };
const model = { providerID: "deepseek", id: "deepseek-flash", variant: "none" };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function backendWith(impl: (url: string, init: RequestInit) => Promise<Response>) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    impl(String(input), init ?? {}),
  );
  return { backend: createOpencodeBackend(conn, fetchImpl as typeof fetch), fetchImpl };
}

function callAt(mock: { mock: { calls: unknown[][] } }, index: number) {
  const call = mock.mock.calls[index];
  if (!call) throw new Error(`no fetch call #${index}`);
  return { url: String(call[0]), init: (call[1] ?? {}) as RequestInit };
}

async function kindOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(BackendError);
  return error as BackendError;
}

describe("generate", () => {
  it("posts prompt and model with basic auth and returns the text", async () => {
    const { backend, fetchImpl } = backendWith(async () => json({ data: { text: "Привет" } }));
    const text = await backend.generate("Hello", model);
    expect(text).toBe("Привет");
    const { url, init } = callAt(fetchImpl, 0);
    expect(url).toBe("http://127.0.0.1:49374/api/experimental/generate/text");
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe(`Basic ${btoa("opencode:tok")}`);
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual({ prompt: "Hello", model });
  });

  it("sends only providerID, id and variant even when given a full ModelInfo", async () => {
    const { backend, fetchImpl } = backendWith(async () => json({ data: { text: "ok" } }));
    const full = {
      providerID: "deepseek",
      id: "deepseek-flash",
      name: "DeepSeek Flash",
      variants: ["none"],
      contextLimit: 1,
      outputLimit: 1,
    };
    await backend.generate("x", full);
    expect(JSON.parse(String(callAt(fetchImpl, 0).init.body))).toEqual({
      prompt: "x",
      model: { providerID: "deepseek", id: "deepseek-flash" },
    });
  });

  it("encodes non-ASCII passwords as UTF-8 before base64", async () => {
    const fetchImpl = vi.fn(async () => json({ data: { text: "ok" } }));
    const backend = createOpencodeBackend(
      { ...conn, password: "пароль" },
      fetchImpl as unknown as typeof fetch,
    );
    await backend.generate("x", model);
    const { init } = callAt(fetchImpl, 0);
    const expected = btoa(String.fromCharCode(...new TextEncoder().encode("opencode:пароль")));
    expect(new Headers(init.headers).get("authorization")).toBe(`Basic ${expected}`);
  });

  it("maps 401 to unauthorized", async () => {
    const { backend } = backendWith(async () =>
      json({ _tag: "UnauthorizedError", message: "Authentication required" }, 401),
    );
    expect((await kindOf(backend.generate("x", model))).kind).toBe("unauthorized");
  });

  it("maps provider rate limit with retryAfterMs", async () => {
    const { backend } = backendWith(async () =>
      json(
        {
          _tag: "ProviderRequestError",
          providerID: "opencode",
          reason: "rate_limit",
          message: "Free usage limit reached",
          status: 429,
          retryAfterMs: 72020000,
        },
        502,
      ),
    );
    const error = await kindOf(backend.generate("x", model));
    expect(error.kind).toBe("rate_limit");
    expect(error.retryAfterMs).toBe(72020000);
  });

  it("treats a null retryAfterMs as absent and still maps to rate_limit", async () => {
    const { backend } = backendWith(async () =>
      json(
        {
          _tag: "ProviderRequestError",
          reason: "rate_limit",
          message: "slow down",
          retryAfterMs: null,
        },
        502,
      ),
    );
    const error = await kindOf(backend.generate("x", model));
    expect(error.kind).toBe("rate_limit");
    expect(error.retryAfterMs).toBeUndefined();
  });

  it("maps provider authentication failure to provider_auth", async () => {
    const { backend } = backendWith(async () =>
      json(
        {
          _tag: "ProviderRequestError",
          providerID: "anthropic",
          reason: "authentication",
          message: "invalid x-api-key",
          status: 401,
        },
        502,
      ),
    );
    expect((await kindOf(backend.generate("x", model))).kind).toBe("provider_auth");
  });

  it("maps other provider errors to provider_error with the message as detail", async () => {
    const { backend } = backendWith(async () =>
      json(
        { _tag: "ProviderRequestError", reason: "overloaded", message: "Provider is busy" },
        502,
      ),
    );
    const error = await kindOf(backend.generate("x", model));
    expect(error.kind).toBe("provider_error");
    expect(error.detail).toBe("Provider is busy");
  });

  it("maps a rejected fetch with TypeError to offline", async () => {
    const { backend } = backendWith(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect((await kindOf(backend.generate("x", model))).kind).toBe("offline");
  });

  it("maps AbortError to aborted", async () => {
    const { backend } = backendWith(async () => {
      throw new DOMException("The operation was aborted", "AbortError");
    });
    expect((await kindOf(backend.generate("x", model))).kind).toBe("aborted");
  });

  it("maps TimeoutError to offline", async () => {
    const { backend } = backendWith(async () => {
      throw new DOMException("timed out", "TimeoutError");
    });
    expect((await kindOf(backend.generate("x", model))).kind).toBe("offline");
  });

  it("maps a 200 body that does not match the schema to incompatible", async () => {
    const { backend } = backendWith(async () => json({ data: { content: "nope" } }));
    expect((await kindOf(backend.generate("x", model))).kind).toBe("incompatible");
  });

  it("maps a body read failure to aborted when the signal is aborted", async () => {
    const controller = new AbortController();
    const { backend } = backendWith(async () => {
      const response = new Response("{}", { status: 200 });
      vi.spyOn(response, "json").mockImplementation(async () => {
        controller.abort();
        throw new TypeError("terminated");
      });
      return response;
    });
    expect((await kindOf(backend.generate("x", model, controller.signal))).kind).toBe("aborted");
  });

  it("maps a 200 body that is not JSON to incompatible", async () => {
    const { backend } = backendWith(async () => new Response("<html>", { status: 200 }));
    expect((await kindOf(backend.generate("x", model))).kind).toBe("incompatible");
  });

  it("maps 404 to incompatible", async () => {
    const { backend } = backendWith(async () => new Response("Not found", { status: 404 }));
    expect((await kindOf(backend.generate("x", model))).kind).toBe("incompatible");
  });

  it("maps a non-JSON 502 body to bad_response", async () => {
    const { backend } = backendWith(
      async () => new Response("<html>Bad Gateway</html>", { status: 502 }),
    );
    expect((await kindOf(backend.generate("x", model))).kind).toBe("bad_response");
  });

  it("maps an unrecognized server failure to bad_response", async () => {
    const { backend } = backendWith(async () => new Response("boom", { status: 500 }));
    expect((await kindOf(backend.generate("x", model))).kind).toBe("bad_response");
  });

  it("passes the abort signal to fetch", async () => {
    const { backend, fetchImpl } = backendWith(async () => json({ data: { text: "ok" } }));
    const controller = new AbortController();
    await backend.generate("x", model, controller.signal);
    expect(callAt(fetchImpl, 0).init.signal).toBe(controller.signal);
  });
});

describe("info", () => {
  it("returns the version and ignores extra fields", async () => {
    const { backend, fetchImpl } = backendWith(async () =>
      json({ version: "2.2.5", pid: 1, urls: ["http://127.0.0.1:49374"] }),
    );
    expect(await backend.info()).toEqual({ version: "2.2.5" });
    expect(callAt(fetchImpl, 0).url).toBe("http://127.0.0.1:49374/api/info");
  });
});

describe("listModels", () => {
  it("maps models, flattens variants and drops disabled ones", async () => {
    const { backend } = backendWith(async () =>
      json({
        location: {},
        data: [
          {
            providerID: "deepseek",
            id: "deepseek-flash",
            name: "DeepSeek Flash",
            variants: [{ id: "none" }, { id: "low" }],
            limit: { context: 1000000, output: 393216 },
            enabled: true,
            status: "active",
          },
          {
            providerID: "x",
            id: "off",
            name: "Off",
            variants: [],
            limit: { context: 1, output: 1 },
            enabled: false,
          },
        ],
      }),
    );
    expect(await backend.listModels()).toEqual([
      {
        providerID: "deepseek",
        id: "deepseek-flash",
        name: "DeepSeek Flash",
        variants: ["none", "low"],
        contextLimit: 1000000,
        outputLimit: 393216,
      },
    ]);
  });
});

describe("url handling", () => {
  it("ignores trailing slashes on conn.url", async () => {
    const fetchImpl = vi.fn(async () => json({ version: "2.2.5" }));
    const backend = createOpencodeBackend(
      { ...conn, url: "http://127.0.0.1:49374//" },
      fetchImpl as unknown as typeof fetch,
    );
    await backend.info();
    expect(callAt(fetchImpl, 0).url).toBe("http://127.0.0.1:49374/api/info");
  });
});

describe("model mapping defaults", () => {
  it("uses 0/0 limits when limit is missing and [] when variants are missing", async () => {
    const { backend } = backendWith(async () =>
      json({ data: [{ providerID: "p", id: "m", name: "M" }] }),
    );
    expect(await backend.listModels()).toEqual([
      { providerID: "p", id: "m", name: "M", variants: [], contextLimit: 0, outputLimit: 0 },
    ]);
  });
});

describe("defaultModel", () => {
  it("returns null when no default is set", async () => {
    const { backend } = backendWith(async () => json({ location: {}, data: null }));
    expect(await backend.defaultModel()).toBeNull();
  });

  it("maps the default model", async () => {
    const { backend, fetchImpl } = backendWith(async () =>
      json({
        data: {
          providerID: "deepseek",
          id: "deepseek-flash",
          name: "DeepSeek Flash",
          variants: [{ id: "none" }],
          limit: { context: 10, output: 5 },
          enabled: true,
        },
      }),
    );
    expect(await backend.defaultModel()).toEqual({
      providerID: "deepseek",
      id: "deepseek-flash",
      name: "DeepSeek Flash",
      variants: ["none"],
      contextLimit: 10,
      outputLimit: 5,
    });
    expect(callAt(fetchImpl, 0).url).toBe("http://127.0.0.1:49374/api/model/default");
  });
});

describe("isFatal", () => {
  it("is true for everything except bad_response", () => {
    expect(isFatal("bad_response")).toBe(false);
    for (const kind of [
      "offline",
      "unauthorized",
      "rate_limit",
      "provider_auth",
      "provider_error",
      "incompatible",
      "aborted",
    ] as const) {
      expect(isFatal(kind)).toBe(true);
    }
  });
});
