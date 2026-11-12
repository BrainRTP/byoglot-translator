import type { z } from "zod";
import type { ProviderData } from "../connections/types";
import { BackendError, fromFetchFailure } from "../opencode/errors";
import type { ModelInfo, ModelRef, TranslationBackend } from "../opencode/types";
import { effortParams, effortVariants, type RawModel } from "./presets";
import { chatSchema, errorBodySchema, modelListSchema } from "./schemas";

const HTTP_DATE =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

function retryAfterMs(header: string | null): number | undefined {
  const value = header?.trim();
  if (!value) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(value)) {
    const ms = Math.round(Number(value) * 1000);
    return Number.isFinite(ms) ? ms : undefined;
  }
  if (!HTTP_DATE.test(value)) return undefined;
  const date = Date.parse(value);
  if (!Number.isFinite(date) || new Date(date).toUTCString() !== value) return undefined;
  return Math.max(0, date - Date.now());
}

async function failureFromResponse(response: Response): Promise<BackendError> {
  const { status } = response;
  if (status === 401 || status === 403) {
    return new BackendError("provider_auth", { status, detail: await messageOf(response) });
  }
  if (status === 404) return new BackendError("incompatible", { detail: "HTTP 404" });
  if (status === 402) {
    return new BackendError("provider_error", { status, detail: "insufficient balance" });
  }
  if (status === 429) {
    return new BackendError("rate_limit", {
      status,
      retryAfterMs: retryAfterMs(response.headers.get("retry-after")),
      detail: await messageOf(response),
    });
  }
  return new BackendError("provider_error", {
    status,
    detail: (await messageOf(response)) ?? `HTTP ${status}`,
  });
}

async function messageOf(response: Response): Promise<string | undefined> {
  const body = await response
    .json()
    .then((raw) => errorBodySchema.safeParse(raw))
    .catch(() => null);
  return body?.success ? body.data.error?.message : undefined;
}

export function createProviderBackend(
  provider: ProviderData,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): TranslationBackend {
  const base = provider.baseUrl.replace(/\/+$/, "");

  function toModelInfo(raw: RawModel): ModelInfo {
    return {
      providerID: provider.preset,
      id: raw.id,
      name: raw.name ?? raw.id,
      variants: effortVariants(provider.preset, raw),
      contextLimit: raw.context_window ?? raw.context_length ?? 0,
      outputLimit: raw.max_output_tokens ?? 0,
    };
  }

  async function call<S extends z.ZodType>(
    path: string,
    schema: S,
    signal: AbortSignal | undefined,
    body?: unknown,
  ): Promise<z.infer<S>> {
    const headers: Record<string, string> = {};
    if (provider.apiKey) headers.authorization = `Bearer ${provider.apiKey}`;
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
      console.warn("Provider response schema mismatch:", parsed.error.message);
      throw new BackendError("incompatible", { detail: "unexpected response shape" });
    }
    return parsed.data;
  }

  async function listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const { data: models } = await call("/models", modelListSchema, signal);
    return models.map(toModelInfo);
  }

  return {
    async info(signal) {
      await listModels(signal);
      return { version: "" };
    },
    listModels,
    async defaultModel(signal) {
      const models = await listModels(signal);
      if (provider.preset === "deepseek")
        return models.find((m) => m.id === "deepseek-flash") ?? null;
      return models[0] ?? null;
    },
    async generate(prompt, model: ModelRef, signal) {
      const { choices } = await call("/chat/completions", chatSchema, signal, {
        model: model.id,
        messages: [{ role: "user", content: prompt }],
        stream: false,
        ...effortParams(provider.preset, model.variant),
      });
      const content = choices[0]?.message.content;
      if (!content) throw new BackendError("bad_response", { detail: "empty completion" });
      return content;
    },
  };
}
