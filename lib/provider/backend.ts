import type { z } from "zod";
import type { ProviderData } from "../connections/types";
import { BackendError, fromFetchFailure } from "../opencode/errors";
import type { ModelInfo, ModelRef, TranslationBackend } from "../opencode/types";
import { effortParams, effortVariants } from "./presets";
import { chatSchema, errorBodySchema, modelListSchema, type modelRawSchema } from "./schemas";

function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

async function failureFromResponse(response: Response): Promise<BackendError> {
  const { status } = response;
  if (status === 401 || status === 403) {
    return new BackendError("provider_auth", { detail: await messageOf(response) });
  }
  if (status === 404) return new BackendError("incompatible", { detail: "HTTP 404" });
  if (status === 402) return new BackendError("provider_error", { detail: "insufficient balance" });
  if (status === 429) {
    return new BackendError("rate_limit", {
      retryAfterMs: retryAfterMs(response.headers.get("retry-after")),
      detail: await messageOf(response),
    });
  }
  return new BackendError("provider_error", {
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

type RawModel = z.infer<typeof modelRawSchema>;

export function createProviderBackend(
  data: ProviderData,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): TranslationBackend {
  const base = data.baseUrl.replace(/\/+$/, "");

  function toModelInfo(raw: RawModel): ModelInfo {
    return {
      providerID: data.preset,
      id: raw.id,
      name: raw.name ?? raw.id,
      variants: effortVariants(data.preset, raw),
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
    if (data.apiKey) headers.authorization = `Bearer ${data.apiKey}`;
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
      if (data.preset === "deepseek") return models.find((m) => m.id === "deepseek-flash") ?? null;
      return models[0] ?? null;
    },
    async generate(prompt, model: ModelRef, signal) {
      const { choices } = await call("/chat/completions", chatSchema, signal, {
        model: model.id,
        messages: [{ role: "user", content: prompt }],
        stream: false,
        ...effortParams(data.preset, model.variant),
      });
      const content = choices[0]?.message.content;
      if (!content) throw new BackendError("bad_response", { detail: "empty completion" });
      return content;
    },
  };
}
