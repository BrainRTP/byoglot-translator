import type { z } from "zod";
import { BackendError, fromFetchFailure } from "./errors";
import {
  defaultModelSchema,
  errorBodySchema,
  generateSchema,
  infoSchema,
  modelListSchema,
  type modelRawSchema,
} from "./schemas";
import type { Connection, ModelInfo, ModelRef, TranslationBackend } from "./types";

function basicAuth(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  return `Basic ${btoa(String.fromCharCode(...bytes))}`;
}

async function failureFromResponse(response: Response): Promise<BackendError> {
  if (response.status === 401) return new BackendError("unauthorized");
  if (response.status === 404) return new BackendError("incompatible", { detail: "HTTP 404" });
  const body = await response
    .json()
    .then((raw) => errorBodySchema.safeParse(raw))
    .catch(() => null);
  const parsed = body?.success ? body.data : null;
  if (parsed?._tag === "ProviderRequestError") {
    if (parsed.reason === "rate_limit") {
      return new BackendError("rate_limit", {
        retryAfterMs: parsed.retryAfterMs ?? undefined,
        detail: parsed.message,
      });
    }
    if (parsed.reason === "authentication") {
      return new BackendError("provider_auth", { detail: parsed.message });
    }
    return new BackendError("provider_error", { detail: parsed.message });
  }
  return new BackendError("bad_response", { detail: parsed?.message ?? `HTTP ${response.status}` });
}

type RawModel = z.infer<typeof modelRawSchema>;

function toModelInfo(raw: RawModel): ModelInfo {
  return {
    providerID: raw.providerID,
    id: raw.id,
    name: raw.name,
    variants: raw.variants.map((v) => v.id),
    contextLimit: raw.limit?.context ?? 0,
    outputLimit: raw.limit?.output ?? 0,
  };
}

export function createOpencodeBackend(
  conn: Connection,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): TranslationBackend {
  const base = conn.url.replace(/\/+$/, "");
  const authorization = basicAuth(conn.username, conn.password);

  async function call<S extends z.ZodType>(
    path: string,
    schema: S,
    signal: AbortSignal | undefined,
    body?: unknown,
  ): Promise<z.infer<S>> {
    const headers: Record<string, string> = { authorization };
    if (body !== undefined) headers["content-type"] = "application/json";
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (error) {
      throw fromFetchFailure(error, signal);
    }
    if (!response.ok) throw await failureFromResponse(response);
    let raw: unknown;
    try {
      raw = await response.json();
    } catch (error) {
      if (signal?.aborted) throw fromFetchFailure(error, signal);
      throw new BackendError("incompatible", { detail: "response is not JSON", cause: error });
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new BackendError("incompatible", { detail: parsed.error.message });
    }
    return parsed.data;
  }

  async function generateWithMetadata(prompt: string, model: ModelRef, signal?: AbortSignal) {
    const { data } = await call("/api/experimental/generate/text", generateSchema, signal, {
      prompt,
      model: {
        providerID: model.providerID,
        id: model.id,
        ...(model.variant !== undefined && { variant: model.variant }),
      },
    });
    const reason = data.finishReason ?? data.finish_reason;
    return {
      text: data.text,
      ...(typeof reason === "string" && {
        truncated: reason === "length" || reason === "max_tokens",
      }),
    };
  }

  return {
    async info(signal) {
      const { version } = await call("/api/info", infoSchema, signal);
      return { version };
    },
    async listModels(signal) {
      const { data } = await call("/api/model", modelListSchema, signal);
      return data.filter((m) => m.enabled !== false).map(toModelInfo);
    },
    async defaultModel(signal) {
      const { data } = await call("/api/model/default", defaultModelSchema, signal);
      return data ? toModelInfo(data) : null;
    },
    generate: async (prompt, model, signal) =>
      (await generateWithMetadata(prompt, model, signal)).text,
    generateWithMetadata,
  };
}
