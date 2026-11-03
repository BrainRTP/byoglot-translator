import { cacheKey, type TranslationCache } from "../cache/cache";
import { BackendError, isFatal } from "../opencode/errors";
import type { ModelRef, TranslationBackend } from "../opencode/types";
import type { EffectiveSettings } from "../settings/types";
import { parsePageResponse } from "./parse";
import { buildPagePrompt, buildSelectionPrompt } from "./prompt";
import { createSemaphore } from "./semaphore";

export type Segment = { id: string; text: string };
export type SegmentResult = { id: string; text: string; cached: boolean };
export type PageJob = {
  segments: Segment[];
  settings: EffectiveSettings;
  model: ModelRef;
  page: { title: string; hostname: string };
};

export interface PageCallbacks {
  onResults(r: SegmentResult[]): void;
  onFailed(ids: string[]): void;
  onFatal(e: BackendError): void;
}

type Limits = { maxBlocks: number; maxChars: number; concurrency: number };
const DEFAULT_LIMITS: Limits = { maxBlocks: 25, maxChars: 4000, concurrency: 4 };

function toBackendError(error: unknown, signal: AbortSignal): BackendError {
  if (error instanceof BackendError) return error;
  if (signal.aborted) return new BackendError("aborted", { cause: error });
  return new BackendError("incompatible", {
    detail: error instanceof Error ? error.message : String(error),
    cause: error,
  });
}

function packBatches(segments: Segment[], limits: Limits): Segment[][] {
  const batches: Segment[][] = [];
  let current: Segment[] = [];
  let chars = 0;
  for (const s of segments) {
    if (
      current.length > 0 &&
      (current.length + 1 > limits.maxBlocks || chars + s.text.length > limits.maxChars)
    ) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(s);
    chars += s.text.length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export function createTranslationService(deps: {
  getBackend(): Promise<TranslationBackend>;
  cache: TranslationCache;
  limits?: Partial<Limits>;
}) {
  const limits: Limits = { ...DEFAULT_LIMITS, ...deps.limits };
  const semaphore = createSemaphore(limits.concurrency);

  async function generate(prompt: string, model: ModelRef, signal: AbortSignal) {
    try {
      return await semaphore.run(async () => {
        const backend = await deps.getBackend();
        signal.throwIfAborted();
        return backend.generate(prompt, model, signal);
      }, signal);
    } catch (error) {
      throw toBackendError(error, signal);
    }
  }

  async function translatePage(job: PageJob, cb: PageCallbacks, signal: AbortSignal) {
    if (signal.aborted) return;
    const controller = new AbortController();
    const onCallerAbort = () => controller.abort();
    signal.addEventListener("abort", onCallerAbort, { once: true });
    const stopped = () => controller.signal.aborted;

    try {
      const { segments, settings, model, page } = job;
      const keyOf = new Map<string, string>();
      await Promise.all(
        segments.map(async (s) => {
          keyOf.set(
            s.id,
            await cacheKey({
              text: s.text,
              sourceLang: settings.sourceLang,
              targetLang: settings.targetLang,
              model,
              prePrompt: settings.prePrompt,
            }),
          );
        }),
      );
      const cached = await deps.cache
        .getMany([...new Set(keyOf.values())])
        .catch(() => new Map<string, string>());
      if (stopped()) return;

      const hits: SegmentResult[] = [];
      const misses: Segment[] = [];
      for (const s of segments) {
        const hit = cached.get(keyOf.get(s.id) ?? "");
        if (hit !== undefined) hits.push({ id: s.id, text: hit, cached: true });
        else misses.push(s);
      }
      if (hits.length > 0) cb.onResults(hits);

      const fail = (error: BackendError) => {
        if (stopped()) return;
        controller.abort();
        if (error.kind !== "aborted") cb.onFatal(error);
      };

      const attempt = async (batch: Segment[]): Promise<Set<string> | null> => {
        if (stopped()) return null;
        const input = Object.fromEntries(batch.map((s) => [s.id, s.text]));
        const prompt = buildPagePrompt({
          prePrompt: settings.prePrompt,
          sourceLang: settings.sourceLang,
          targetLang: settings.targetLang,
          pageTitle: page.title,
          hostname: page.hostname,
          segments: input,
        });
        let raw: string;
        try {
          raw = await generate(prompt, model, controller.signal);
        } catch (e) {
          const error = toBackendError(e, controller.signal);
          if (isFatal(error.kind)) {
            fail(error);
            return null;
          }
          return new Set(batch.map((s) => s.id));
        }
        if (stopped()) return null;
        const { ok, failed } = parsePageResponse(raw, input);
        if (Object.keys(ok).length > 0) {
          const entries = Object.entries(ok);
          cb.onResults(entries.map(([id, text]) => ({ id, text, cached: false })));
          try {
            await deps.cache.putMany(entries.map(([id, text]) => [keyOf.get(id) ?? "", text]));
          } catch {}
        }
        return new Set(failed);
      };

      const runBatch = async (batch: Segment[]) => {
        let failed = await attempt(batch);
        if (!failed || failed.size === 0) return;
        const regroup = batch.filter((s) => failed?.has(s.id));
        failed = await attempt(regroup);
        if (!failed || failed.size === 0) return;
        const singles = regroup.filter((s) => failed?.has(s.id));
        const still: string[] = [];
        await Promise.all(
          singles.map(async (s) => {
            const r = await attempt([s]);
            if (r?.size) still.push(s.id);
          }),
        );
        if (still.length > 0 && !stopped()) {
          cb.onFailed(singles.filter((s) => still.includes(s.id)).map((s) => s.id));
        }
      };

      await Promise.all(packBatches(misses, limits).map(runBatch));
    } finally {
      signal.removeEventListener("abort", onCallerAbort);
    }
  }

  async function translateSelection(
    i: {
      text: string;
      context: string;
      settings: EffectiveSettings;
      model: ModelRef;
      hostname: string;
    },
    signal: AbortSignal,
  ): Promise<string> {
    const prompt = buildSelectionPrompt({
      prePrompt: i.settings.prePrompt,
      sourceLang: i.settings.sourceLang,
      targetLang: i.settings.targetLang,
      text: i.text,
      context: i.context,
      hostname: i.hostname,
    });
    return (await generate(prompt, i.model, signal)).trim();
  }

  return { translatePage, translateSelection };
}
