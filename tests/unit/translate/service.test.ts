import { describe, expect, it, vi } from "vitest";
import type { TranslationCache } from "../../../lib/cache/cache";
import { cacheKey } from "../../../lib/cache/cache";
import { BackendError, fromFetchFailure } from "../../../lib/opencode/errors";
import type { BackendErrorKind, ModelRef, TranslationBackend } from "../../../lib/opencode/types";
import type { EffectiveSettings } from "../../../lib/settings/types";
import { createSemaphore } from "../../../lib/translate/semaphore";
import {
  createTranslationService,
  type PageCallbacks,
  type PageJob,
  type Segment,
  type SegmentResult,
} from "../../../lib/translate/service";

const model: ModelRef = { providerID: "p", id: "m" };
const settings: EffectiveSettings = {
  templateId: "t",
  prePrompt: "pp",
  sourceLang: "auto",
  targetLang: "ru",
  displayMode: "replace",
  visibleOnly: false,
  pageModel: model,
  selectionModel: model,
};

const seg = (n: number, len = 5): Segment => ({ id: String(n), text: "x".repeat(len) });
const segs = (n: number, len = 5) => Array.from({ length: n }, (_, i) => seg(i + 1, len));

function job(segments: Segment[]): PageJob {
  return {
    segments,
    settings,
    model,
    languagePrompt: "",
    page: { title: "T", hostname: "example.com" },
  };
}

function memoryCache(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const cache: TranslationCache = {
    async getMany(keys) {
      const m = new Map<string, string>();
      for (const k of keys) {
        const v = store.get(k);
        if (v !== undefined) m.set(k, v);
      }
      return m;
    },
    async putMany(entries) {
      for (const [k, v] of entries) store.set(k, v);
    },
    async clear() {
      store.clear();
    },
    async stats() {
      return { entries: store.size };
    },
  };
  return { cache, store };
}

function recorder() {
  const results: SegmentResult[][] = [];
  const failed: string[][] = [];
  const fatal: BackendError[] = [];
  const cb: PageCallbacks = {
    onResults: (r) => results.push(r),
    onFailed: (ids) => failed.push(ids),
    onFatal: (e) => fatal.push(e),
  };
  return { cb, results, failed, fatal, flat: () => results.flat() };
}

function inputIds(prompt: string): string[] {
  const json = prompt.slice(prompt.indexOf("INPUT:\n") + "INPUT:\n".length);
  return Object.keys(JSON.parse(json));
}

function echoAnswer(prompt: string, skip: (id: string) => boolean = () => false): string {
  const input = JSON.parse(prompt.slice(prompt.indexOf("INPUT:\n") + 7)) as Record<string, string>;
  const out: Record<string, string> = {};
  for (const id of Object.keys(input)) if (!skip(id)) out[id] = `T${id}`;
  return JSON.stringify(out);
}

type Handler = (prompt: string, signal: AbortSignal | undefined, call: number) => Promise<string>;

function fakeBackend(handler: Handler = async (p) => echoAnswer(p)) {
  const prompts: string[] = [];
  const signals: (AbortSignal | undefined)[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const backend: TranslationBackend = {
    async info() {
      return { version: "2" };
    },
    async listModels() {
      return [];
    },
    async defaultModel() {
      return null;
    },
    async generate(prompt, _model, signal) {
      const call = prompts.length;
      prompts.push(prompt);
      signals.push(signal);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        return await handler(prompt, signal, call);
      } finally {
        inFlight--;
      }
    },
  };
  return {
    backend,
    prompts,
    signals,
    get maxInFlight() {
      return maxInFlight;
    },
    get inFlight() {
      return inFlight;
    },
  };
}

function service(
  fake: ReturnType<typeof fakeBackend>,
  cache: TranslationCache = memoryCache().cache,
  limits?: Parameters<typeof createTranslationService>[0]["limits"],
) {
  return createTranslationService({ getBackend: async () => fake.backend, cache, limits });
}

function deferred<T = string>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
async function until(cond: () => boolean) {
  for (let i = 0; i < 200 && !cond(); i++) await tick();
  expect(cond()).toBe(true);
}

describe("createSemaphore", () => {
  it("limits concurrent runs and starts queued ones in order", async () => {
    const sem = createSemaphore(2);
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()];
    const started: number[] = [];
    const runs = gates.map((g, i) =>
      sem.run(async () => {
        started.push(i);
        await g.promise;
        return i;
      }),
    );
    await tick();
    expect(started).toEqual([0, 1]);
    gates[0]?.resolve();
    await tick();
    expect(started).toEqual([0, 1, 2]);
    gates[1]?.resolve();
    gates[2]?.resolve();
    expect(await Promise.all(runs)).toEqual([0, 1, 2]);
  });

  it("releases the slot when fn rejects", async () => {
    const sem = createSemaphore(1);
    await expect(sem.run(async () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    expect(await sem.run(async () => 5)).toBe(5);
  });

  it("removes an aborted waiter from the queue without taking a slot", async () => {
    const sem = createSemaphore(1);
    const gate = deferred<void>();
    const first = sem.run(() => gate.promise);
    const ac = new AbortController();
    let ran = false;
    const waiting = sem.run(async () => {
      ran = true;
    }, ac.signal);
    const third = sem.run(async () => "third");
    ac.abort();
    await expect(waiting).rejects.toBeDefined();
    gate.resolve();
    await first;
    expect(await third).toBe("third");
    expect(ran).toBe(false);
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const sem = createSemaphore(1);
    const ac = new AbortController();
    ac.abort();
    let ran = false;
    await expect(
      sem.run(async () => {
        ran = true;
      }, ac.signal),
    ).rejects.toBeDefined();
    expect(ran).toBe(false);
  });
});

describe("translatePage batching", () => {
  it("splits 60 short segments into 25, 25, 10", async () => {
    const fake = fakeBackend();
    const rec = recorder();
    await service(fake).translatePage(job(segs(60)), rec.cb, new AbortController().signal);
    expect(fake.prompts.map((p) => inputIds(p).length)).toEqual([25, 25, 10]);
    expect(rec.flat()).toHaveLength(60);
    expect(rec.flat().every((r) => !r.cached)).toBe(true);
    expect(rec.failed).toEqual([]);
  });

  it("respects the 4000 char limit", async () => {
    const fake = fakeBackend();
    await service(fake).translatePage(
      job(segs(10, 1000)),
      recorder().cb,
      new AbortController().signal,
    );
    expect(fake.prompts.map((p) => inputIds(p).length)).toEqual([4, 4, 2]);
  });

  it("puts a segment longer than the limit into its own batch", async () => {
    const fake = fakeBackend();
    const input = [seg(1, 10), seg(2, 5000), seg(3, 10), seg(4, 10)];
    await service(fake).translatePage(job(input), recorder().cb, new AbortController().signal);
    expect(fake.prompts.map(inputIds)).toEqual([["1"], ["2"], ["3", "4"]]);
  });

  it("honours custom limits", async () => {
    const fake = fakeBackend();
    await service(fake, undefined, { maxBlocks: 2 }).translatePage(
      job(segs(5)),
      recorder().cb,
      new AbortController().signal,
    );
    expect(fake.prompts.map((p) => inputIds(p).length)).toEqual([2, 2, 1]);
  });

  it("puts page metadata and settings into the prompt", async () => {
    const fake = fakeBackend();
    await service(fake).translatePage(job(segs(1)), recorder().cb, new AbortController().signal);
    expect(fake.prompts[0]).toContain('Page: "T" on example.com.');
    expect(fake.prompts[0]).toContain("pp");
  });
});

describe("translatePage cache", () => {
  it("reports cached segments once with cached: true and does not request them", async () => {
    const input = segs(4);
    const key = (s: Segment) =>
      cacheKey({
        text: s.text,
        sourceLang: "auto",
        targetLang: "ru",
        model,
        prePrompt: "pp",
        languagePrompt: "",
      });
    const first = input[0] ?? seg(1);
    const { cache } = memoryCache({ [await key(first)]: "cached-1" });
    const fake = fakeBackend();
    const rec = recorder();
    const sameText = [
      { id: "1", text: first.text },
      { id: "2", text: "other" },
    ];
    await service(fake, cache).translatePage(job(sameText), rec.cb, new AbortController().signal);
    expect(rec.results[0]).toEqual([{ id: "1", text: "cached-1", cached: true }]);
    expect(fake.prompts.map(inputIds)).toEqual([["2"]]);
    expect(rec.results[1]).toEqual([{ id: "2", text: "T2", cached: false }]);
  });

  it("makes no request when everything is cached", async () => {
    const input = segs(2);
    const entries: Record<string, string> = {};
    for (const s of input) {
      entries[
        await cacheKey({
          text: s.text,
          sourceLang: "auto",
          targetLang: "ru",
          model,
          prePrompt: "pp",
          languagePrompt: "",
        })
      ] = "c";
    }
    const fake = fakeBackend();
    const rec = recorder();
    await service(fake, memoryCache(entries).cache).translatePage(
      job([{ id: "a", text: "xxxxx" }]),
      rec.cb,
      new AbortController().signal,
    );
    expect(fake.prompts).toHaveLength(0);
    expect(rec.results).toEqual([[{ id: "a", text: "c", cached: true }]]);
  });

  it("does not reuse a cached translation made for another source language", async () => {
    const stale = await cacheKey({
      text: "hello",
      sourceLang: "de",
      targetLang: "ru",
      model,
      prePrompt: "pp",
      languagePrompt: "",
    });
    const { cache } = memoryCache({ [stale]: "old" });
    const fake = fakeBackend();
    const rec = recorder();
    await service(fake, cache).translatePage(
      job([{ id: "1", text: "hello" }]),
      rec.cb,
      new AbortController().signal,
    );
    expect(fake.prompts).toHaveLength(1);
    expect(rec.results[0]).toEqual([{ id: "1", text: "T1", cached: false }]);
  });

  it("puts the job language prompt into the prompt sent to the backend", async () => {
    const fake = fakeBackend();
    await service(fake).translatePage(
      { ...job(segs(1)), languagePrompt: "  Use formal tone.  " },
      recorder().cb,
      new AbortController().signal,
    );
    expect(fake.prompts[0]).toContain(
      "LANGUAGE STYLE (the user instructions below override it):\nUse formal tone.\n\nUSER INSTRUCTIONS:",
    );
  });

  it("does not reuse a cached translation made with another language prompt", async () => {
    const { cache } = memoryCache();
    const fake = fakeBackend();
    const svc = service(fake, cache);
    const one = [{ id: "1", text: "hello" }];
    await svc.translatePage(
      { ...job(one), languagePrompt: "A" },
      recorder().cb,
      new AbortController().signal,
    );
    expect(fake.prompts).toHaveLength(1);
    const rec = recorder();
    await svc.translatePage(
      { ...job(one), languagePrompt: "B" },
      rec.cb,
      new AbortController().signal,
    );
    expect(fake.prompts).toHaveLength(2);
    expect(rec.results[0]).toEqual([{ id: "1", text: "T1", cached: false }]);
    const again = recorder();
    await svc.translatePage(
      { ...job(one), languagePrompt: "A" },
      again.cb,
      new AbortController().signal,
    );
    expect(fake.prompts).toHaveLength(2);
    expect(again.results[0]).toEqual([{ id: "1", text: "T1", cached: true }]);
  });

  it("writes successful results to the cache", async () => {
    const { cache, store } = memoryCache();
    const fake = fakeBackend();
    await service(fake, cache).translatePage(
      job([{ id: "1", text: "hello" }]),
      recorder().cb,
      new AbortController().signal,
    );
    const key = await cacheKey({
      text: "hello",
      sourceLang: "auto",
      targetLang: "ru",
      model,
      prePrompt: "pp",
      languagePrompt: "",
    });
    expect(store.get(key)).toBe("T1");
  });

  it("does not fail the job when cache writes fail", async () => {
    const base = memoryCache().cache;
    const cache: TranslationCache = {
      ...base,
      putMany: async () => {
        throw new Error("quota");
      },
    };
    const rec = recorder();
    await service(fakeBackend(), cache).translatePage(
      job(segs(2)),
      rec.cb,
      new AbortController().signal,
    );
    expect(rec.flat()).toHaveLength(2);
    expect(rec.fatal).toEqual([]);
  });
});

describe("translatePage concurrency", () => {
  it("keeps at most 4 generate calls in flight, shared across jobs", async () => {
    const gates: ReturnType<typeof deferred<string>>[] = [];
    const fake = fakeBackend((p) => {
      const g = deferred();
      gates.push(g);
      return g.promise.then(() => echoAnswer(p));
    });
    const svc = service(fake);
    const ac = new AbortController();
    const a = svc.translatePage(job(segs(125)), recorder().cb, ac.signal);
    const b = svc.translatePage(
      job(segs(125).map((s) => ({ ...s, id: `b${s.id}`, text: `b${s.text}` }))),
      recorder().cb,
      ac.signal,
    );
    await until(() => fake.inFlight === 4);
    await tick();
    expect(fake.inFlight).toBe(4);
    expect(fake.prompts).toHaveLength(4);
    let released = 0;
    while (released < 10) {
      await until(() => gates.length > released);
      gates[released++]?.resolve("");
      await tick();
      expect(fake.inFlight).toBeLessThanOrEqual(4);
    }
    ac.abort();
    for (const g of gates) g.resolve("");
    await Promise.all([a, b]);
    expect(fake.maxInFlight).toBe(4);
  });

  it("retry requests go through the shared semaphore", async () => {
    const fake = fakeBackend(async (p, _s, call) =>
      call < 2 ? echoAnswer(p, (id) => id === "1") : echoAnswer(p),
    );
    const svc = service(fake, undefined, { concurrency: 1 });
    await svc.translatePage(job(segs(3)), recorder().cb, new AbortController().signal);
    expect(fake.maxInFlight).toBe(1);
  });
});

describe("translatePage retries", () => {
  it("retries failed ids together, then one by one, then reports them", async () => {
    const fake = fakeBackend(async (p) =>
      echoAnswer(p, (id) => id === "2" || id === "3" || id === "4"),
    );
    const rec = recorder();
    await service(fake).translatePage(job(segs(5)), rec.cb, new AbortController().signal);
    expect(fake.prompts.map(inputIds)).toEqual([
      ["1", "2", "3", "4", "5"],
      ["2", "3", "4"],
      ["2"],
      ["3"],
      ["4"],
    ]);
    expect(rec.flat().map((r) => r.id)).toEqual(["1", "5"]);
    expect(rec.failed.flat()).toEqual(["2", "3", "4"]);
  });

  it("recovers ids in the grouped retry", async () => {
    const fake = fakeBackend(async (p, _s, call) =>
      call === 0 ? echoAnswer(p, (id) => id === "2") : echoAnswer(p),
    );
    const rec = recorder();
    await service(fake).translatePage(job(segs(3)), rec.cb, new AbortController().signal);
    expect(fake.prompts.map(inputIds)).toEqual([["1", "2", "3"], ["2"]]);
    expect(
      rec
        .flat()
        .map((r) => r.id)
        .sort(),
    ).toEqual(["1", "2", "3"]);
    expect(rec.failed).toEqual([]);
  });

  it("recovers ids in the single retry", async () => {
    const fake = fakeBackend(async (p) =>
      inputIds(p).length > 1 ? echoAnswer(p, (id) => id !== "1") : echoAnswer(p),
    );
    const rec = recorder();
    await service(fake).translatePage(job(segs(3)), rec.cb, new AbortController().signal);
    expect(
      rec
        .flat()
        .map((r) => r.id)
        .sort(),
    ).toEqual(["1", "2", "3"]);
    expect(rec.failed).toEqual([]);
  });

  it("treats bad_response as failing all ids of that request", async () => {
    const fake = fakeBackend(async (p, _s, call) => {
      if (call === 0) throw new BackendError("bad_response");
      return echoAnswer(p);
    });
    const rec = recorder();
    await service(fake).translatePage(job(segs(3)), rec.cb, new AbortController().signal);
    expect(fake.prompts.map(inputIds)).toEqual([
      ["1", "2", "3"],
      ["1", "2", "3"],
    ]);
    expect(rec.flat()).toHaveLength(3);
    expect(rec.failed).toEqual([]);
    expect(rec.fatal).toEqual([]);
  });

  it("reports every id when the model keeps answering garbage", async () => {
    const fake = fakeBackend(async () => "not json");
    const rec = recorder();
    await service(fake).translatePage(job(segs(2)), rec.cb, new AbortController().signal);
    expect(rec.flat()).toEqual([]);
    expect(rec.failed.flat().sort()).toEqual(["1", "2"]);
    expect(fake.prompts).toHaveLength(1 + 1 + 2);
  });
});

describe("translatePage fatal errors", () => {
  const kinds: BackendErrorKind[] = [
    "unauthorized",
    "rate_limit",
    "offline",
    "provider_auth",
    "provider_error",
    "incompatible",
  ];

  for (const kind of kinds) {
    it(`calls onFatal once and starts nothing new on ${kind}`, async () => {
      const failFirst = deferred();
      const fake = fakeBackend((_p, signal, call) => {
        if (call === 0) return failFirst.promise;
        return new Promise<string>((_res, rej) =>
          signal?.addEventListener("abort", () => rej(new BackendError("aborted"))),
        );
      });
      const rec = recorder();
      const done = service(fake).translatePage(
        job(segs(200)),
        rec.cb,
        new AbortController().signal,
      );
      await until(() => fake.prompts.length === 4);
      failFirst.reject(new BackendError(kind, { retryAfterMs: 5 }));
      await done;
      expect(rec.fatal).toHaveLength(1);
      expect(rec.fatal[0]?.kind).toBe(kind);
      expect(rec.fatal[0]?.retryAfterMs).toBe(5);
      expect(fake.prompts).toHaveLength(4);
      expect(rec.results).toEqual([]);
      expect(rec.failed).toEqual([]);
    });
  }

  it("cancels in-flight requests of the same job and ignores their late results", async () => {
    const gate = deferred();
    const fake = fakeBackend((p, signal, call) => {
      if (call === 0) return Promise.reject(new BackendError("offline"));
      return new Promise<string>((resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new BackendError("aborted")));
        gate.promise.then(() => resolve(echoAnswer(p)));
      });
    });
    const rec = recorder();
    await service(fake).translatePage(job(segs(75)), rec.cb, new AbortController().signal);
    expect(fake.signals[1]?.aborted).toBe(true);
    expect(rec.fatal).toHaveLength(1);
    expect(rec.results).toEqual([]);
  });

  it("does not affect other jobs of the same service", async () => {
    const svc = service(fakeBackend());
    const a = recorder();
    await svc.translatePage(job(segs(2)), a.cb, new AbortController().signal);
    expect(a.flat()).toHaveLength(2);
  });

  it("reports a non-BackendError from getBackend as fatal", async () => {
    const svc = createTranslationService({
      getBackend: async () => {
        throw new Error("no connection");
      },
      cache: memoryCache().cache,
    });
    const rec = recorder();
    await svc.translatePage(job(segs(2)), rec.cb, new AbortController().signal);
    expect(rec.fatal).toHaveLength(1);
  });
});

describe("translatePage abort", () => {
  it("passes the signal on, starts nothing new and stays silent after abort", async () => {
    const gates: ReturnType<typeof deferred<string>>[] = [];
    const fake = fakeBackend((p, signal) => {
      const g = deferred();
      gates.push(g);
      signal?.addEventListener("abort", () => g.reject(new BackendError("aborted")));
      return g.promise.then(() => echoAnswer(p));
    });
    const ac = new AbortController();
    const rec = recorder();
    const done = service(fake).translatePage(job(segs(200)), rec.cb, ac.signal);
    await until(() => fake.inFlight === 4);
    expect(fake.signals.every((s) => s && !s.aborted)).toBe(true);
    ac.abort();
    await done;
    expect(fake.signals.slice(0, 4).every((s) => s?.aborted)).toBe(true);
    expect(fake.prompts).toHaveLength(4);
    expect(rec.results).toEqual([]);
    expect(rec.failed).toEqual([]);
    expect(rec.fatal).toEqual([]);
  });

  it("ignores results that arrive after abort", async () => {
    const gate = deferred();
    const fake = fakeBackend((p) => gate.promise.then(() => echoAnswer(p)));
    const ac = new AbortController();
    const rec = recorder();
    const done = service(fake).translatePage(job(segs(2)), rec.cb, ac.signal);
    await until(() => fake.prompts.length === 1);
    ac.abort();
    gate.resolve("");
    await done;
    expect(rec.results).toEqual([]);
  });

  it("does nothing when the signal is already aborted", async () => {
    const fake = fakeBackend();
    const ac = new AbortController();
    ac.abort();
    const rec = recorder();
    await service(fake).translatePage(job(segs(2)), rec.cb, ac.signal);
    expect(fake.prompts).toHaveLength(0);
    expect(rec.results).toEqual([]);
  });

  it("does not run queued requests of an aborted job", async () => {
    const gate = deferred();
    const fake = fakeBackend((p) => gate.promise.then(() => echoAnswer(p)));
    const svc = service(fake, undefined, { concurrency: 1 });
    const acA = new AbortController();
    const a = svc.translatePage(job(segs(60)), recorder().cb, acA.signal);
    await until(() => fake.prompts.length === 1);
    acA.abort();
    gate.resolve("");
    await a;
    expect(fake.prompts).toHaveLength(1);
    const rec = recorder();
    await svc.translatePage(job([{ id: "z", text: "zzz" }]), rec.cb, new AbortController().signal);
    expect(rec.flat()).toHaveLength(1);
  });
});

describe("translateSelection", () => {
  const input = {
    text: "Hello",
    context: "ctx",
    settings,
    model,
    hostname: "example.com",
    languagePrompt: "",
  };

  it("uses the plain-text prompt for editor requests without selection context", async () => {
    const fake = fakeBackend(async () => "  Translation\n");
    const out = await service(fake).translateText(
      { ...input, languagePrompt: "Formal tone" },
      new AbortController().signal,
    );
    expect(out).toEqual({ text: "Translation" });
    expect(fake.prompts).toHaveLength(1);
    expect(fake.prompts[0]).toContain("The text comes from the app ByoGlot Translator.");
    expect(fake.prompts[0]).toContain("Formal tone");
    expect(fake.prompts[0]).toContain("TEXT:\nHello");
    expect(fake.prompts[0]).not.toContain("CONTEXT");
    expect(fake.prompts[0]).not.toContain("example.com");
  });

  it("returns the trimmed raw text and builds the selection prompt", async () => {
    const fake = fakeBackend(async () => "  Привет\n");
    const out = await service(fake).translateSelection(input, new AbortController().signal);
    expect(out).toBe("Привет");
    expect(fake.prompts[0]).toContain("TEXT:\nHello");
    expect(fake.prompts[0]).toContain("CONTEXT (do not translate):\nctx");
  });

  it("puts the language prompt block into the selection prompt", async () => {
    const fake = fakeBackend(async () => "ok");
    await service(fake).translateSelection(
      { ...input, languagePrompt: "Use formal tone." },
      new AbortController().signal,
    );
    expect(fake.prompts[0]).toContain(
      "LANGUAGE STYLE (the user instructions below override it):\nUse formal tone.\n\nUSER INSTRUCTIONS:",
    );
  });

  it("throws BackendError on failure", async () => {
    const fake = fakeBackend(async () => {
      throw new BackendError("rate_limit");
    });
    await expect(
      service(fake).translateSelection(input, new AbortController().signal),
    ).rejects.toMatchObject({ name: "BackendError", kind: "rate_limit" });
  });

  it("throws BackendError(aborted) when aborted", async () => {
    const fake = fakeBackend((_p, signal) => {
      return new Promise<string>((_res, rej) =>
        signal?.addEventListener("abort", () => rej(new DOMException("x", "AbortError"))),
      );
    });
    const ac = new AbortController();
    const p = service(fake).translateSelection(input, ac.signal);
    await until(() => fake.prompts.length === 1);
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: "BackendError", kind: "aborted" });
  });

  it("maps a generate timeout to offline, not aborted", async () => {
    const timeout = AbortSignal.abort(new DOMException("timed out", "TimeoutError"));
    const spy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout);
    try {
      const fake = fakeBackend(async (_p, signal) => {
        throw fromFetchFailure(signal?.reason, signal);
      });
      await expect(
        service(fake).translateSelection(input, new AbortController().signal),
      ).rejects.toMatchObject({ kind: "offline" });
    } finally {
      spy.mockRestore();
    }
  });

  it("shares the concurrency limit with page jobs", async () => {
    const gates: ReturnType<typeof deferred<string>>[] = [];
    const fake = fakeBackend((p) => {
      const g = deferred();
      gates.push(g);
      return g.promise.then(() => (p.includes("INPUT:") ? echoAnswer(p) : "sel"));
    });
    const svc = service(fake, undefined, { concurrency: 1 });
    const page = svc.translatePage(job(segs(1)), recorder().cb, new AbortController().signal);
    await until(() => fake.prompts.length === 1);
    const sel = svc.translateSelection(input, new AbortController().signal);
    await tick();
    expect(fake.prompts).toHaveLength(1);
    gates[0]?.resolve("");
    await page;
    await until(() => fake.prompts.length === 2);
    gates[1]?.resolve("");
    expect(await sel).toBe("sel");
  });
});

describe("translateText", () => {
  const input = { text: "x".repeat(20_000), settings, model, languagePrompt: "" };

  it("keeps one request and carries completion metadata from the backend", async () => {
    const fake = fakeBackend();
    const generateWithMetadata = vi.fn(async () => ({ text: "  Partial  ", truncated: true }));
    fake.backend.generateWithMetadata = generateWithMetadata;
    const result = await service(fake).translateText(input, new AbortController().signal);
    expect(result).toEqual({ text: "Partial", truncated: true });
    expect(generateWithMetadata).toHaveBeenCalledTimes(1);
    expect(generateWithMetadata.mock.calls[0]).toBeDefined();
    expect(fake.prompts).toHaveLength(0);
  });

  it("preserves the 180-second timeout and identifies it for the editor", async () => {
    const timeout = AbortSignal.abort(new DOMException("timed out", "TimeoutError"));
    const spy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout);
    try {
      const fake = fakeBackend(async (_prompt, signal) => {
        throw fromFetchFailure(signal?.reason, signal);
      });
      await expect(
        service(fake).translateText(input, new AbortController().signal),
      ).rejects.toMatchObject({ kind: "offline", detail: "timeout" });
      expect(spy).toHaveBeenCalledWith(180_000);
      expect(fake.prompts).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });
});
