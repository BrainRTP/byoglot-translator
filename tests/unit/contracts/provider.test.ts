import { vi } from "vitest";
import type { ProviderData, ProviderPreset } from "../../../lib/connections/types";
import { BackendError } from "../../../lib/opencode/errors";
import type { ModelRef } from "../../../lib/opencode/types";
import { createProviderBackend } from "../../../lib/provider/backend";
import {
  effortParams,
  effortVariants,
  needsKey,
  type RawModel,
} from "../../../lib/provider/presets";
import { runContract } from "./harness";

type Http = { status: number; headers: Record<string, string>; body: unknown };
type ErrorShape = { kind: string; status?: number; retryAfterMs?: number; detail?: string };
type RecordedRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
};

function respond(http: Http): Response {
  return new Response(typeof http.body === "string" ? http.body : JSON.stringify(http.body), {
    status: http.status,
    headers: http.headers,
  });
}

function recorded(provider: ProviderData, http: Http) {
  let lastRequest: RecordedRequest | undefined;
  const backend = createProviderBackend(provider, async (input, init) => {
    lastRequest = {
      method: init?.method ?? "GET",
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      ...(typeof init?.body === "string" ? { body: JSON.parse(init.body) } : {}),
    };
    return respond(http);
  });
  return {
    backend,
    request() {
      if (!lastRequest) throw new Error("No provider request recorded");
      return lastRequest;
    },
  };
}

function shape(error: unknown): ErrorShape {
  if (!(error instanceof BackendError)) throw error;
  return {
    kind: error.kind,
    ...(error.status === undefined ? {} : { status: error.status }),
    ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
    ...(error.detail === undefined ? {} : { detail: error.detail }),
  };
}

runContract("provider-models", async (i: { provider: ProviderData; response: Http }) => {
  const { backend, request } = recorded(i.provider, i.response);
  const models = await backend.listModels();
  const defaultModel = await backend.defaultModel();
  return { request: request(), models, defaultModel };
});
runContract(
  "provider-chat",
  async (i: { provider: ProviderData; model: ModelRef; prompt: string; response: Http }) => {
    const { backend, request } = recorded(i.provider, i.response);
    let result: { content: string } | { error: ErrorShape };
    try {
      result = { content: await backend.generate(i.prompt, i.model) };
    } catch (error) {
      result = { error: shape(error) };
    }
    return { request: request(), result };
  },
);
runContract(
  "provider-errors",
  async (i: { provider: ProviderData; response: Http; now?: string }) => {
    if (i.now !== undefined) {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(i.now));
    }
    const { backend } = recorded(i.provider, i.response);
    try {
      await backend.listModels();
    } catch (error) {
      return shape(error);
    } finally {
      if (i.now !== undefined) vi.useRealTimers();
    }
    throw new Error("Expected provider request to fail");
  },
);
runContract(
  "provider-effort",
  (i: { preset: ProviderPreset; rawModel: RawModel; variant?: string; baseUrl: string }) => ({
    variants: effortVariants(i.preset, i.rawModel),
    params: effortParams(i.preset, i.variant),
    needsKey: needsKey(i.preset, i.baseUrl),
  }),
);
