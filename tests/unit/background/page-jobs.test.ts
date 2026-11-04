import { describe, expect, it, vi } from "vitest";
import type { Handlers } from "../../../lib/background/handlers";
import { attachPagePort, type PagePort } from "../../../lib/background/page-jobs";
import type { PortToBackground, PortToContent } from "../../../lib/messaging/page-port";
import { BackendError } from "../../../lib/opencode/errors";
import type { PageCallbacks, PageJob } from "../../../lib/translate/service";

const job = {
  segments: [],
  languagePrompt: "",
  page: { title: "T", hostname: "h" },
} as unknown as PageJob;
const translate: PortToBackground = {
  type: "translate",
  jobId: "j1",
  segments: [{ id: "1", text: "a" }],
  page: { title: "T", hostname: "h" },
};

function fakePort() {
  const sent: PortToContent[] = [];
  let onMessage: (m: PortToBackground) => void = () => {};
  let onDisconnect: () => void = () => {};
  const port: PagePort = {
    sender: { tab: { id: 1, url: "https://h/" } },
    postMessage: (m) => sent.push(m),
    onMessage: { addListener: (cb) => (onMessage = cb) },
    onDisconnect: { addListener: (cb) => (onDisconnect = cb) },
  };
  return {
    port,
    sent,
    send: (m: PortToBackground) => onMessage(m),
    disconnect: () => onDisconnect(),
  };
}

const handlersWith = (pageJob: () => Promise<PageJob>, kind?: "opencode" | "provider") =>
  ({ pageJob, activeKind: async () => kind }) as unknown as Handlers;
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("attachPagePort", () => {
  it("forwards callbacks and posts done", async () => {
    const { port, sent, send } = fakePort();
    const translatePage = vi.fn(async (_j: PageJob, cb: PageCallbacks) => {
      cb.onResults([{ id: "1", text: "b", cached: false }]);
      cb.onFailed(["2"]);
    });
    attachPagePort(
      port,
      handlersWith(async () => job),
      { translatePage },
    );
    send(translate);
    await tick();
    expect(sent).toEqual([
      { type: "results", jobId: "j1", results: [{ id: "1", text: "b", cached: false }] },
      { type: "failed", jobId: "j1", ids: ["2"] },
      { type: "done", jobId: "j1" },
    ]);
  });

  it.each(["unauthorized", "no_model"] as const)(
    "posts fatal %s when the job cannot be built",
    async (kind) => {
      const { port, sent, send } = fakePort();
      const translatePage = vi.fn(async () => {});
      attachPagePort(
        port,
        handlersWith(async () => {
          throw new BackendError(kind);
        }),
        { translatePage },
      );
      send(translate);
      await tick();
      expect(sent).toEqual([{ type: "fatal", jobId: "j1", kind, retryAfterMs: undefined }]);
      expect(translatePage).not.toHaveBeenCalled();
    },
  );

  it("forwards fatal errors from the service", async () => {
    const { port, sent, send } = fakePort();
    const translatePage = vi.fn(async (_j: PageJob, cb: PageCallbacks) => {
      cb.onFatal(new BackendError("rate_limit", { retryAfterMs: 900 }));
    });
    attachPagePort(
      port,
      handlersWith(async () => job),
      { translatePage },
    );
    send(translate);
    await tick();
    expect(sent[0]).toEqual({ type: "fatal", jobId: "j1", kind: "rate_limit", retryAfterMs: 900 });
  });

  it("tags fatal errors with the active connection kind", async () => {
    const { port, sent, send } = fakePort();
    attachPagePort(
      port,
      handlersWith(async () => {
        throw new BackendError("provider_auth");
      }, "provider"),
      { translatePage: vi.fn(async () => {}) },
    );
    send(translate);
    await tick();
    expect(sent[0]).toMatchObject({ type: "fatal", kind: "provider_auth", backend: "provider" });
  });

  it("posts a service fatal with its backend before done", async () => {
    const { port, sent, send } = fakePort();
    const translatePage = vi.fn(async (_j: PageJob, cb: PageCallbacks) => {
      cb.onFatal(new BackendError("rate_limit"));
    });
    attachPagePort(
      port,
      handlersWith(async () => job, "provider"),
      { translatePage },
    );
    send(translate);
    await tick();
    expect(sent.map((m) => m.type)).toEqual(["fatal", "done"]);
    expect(sent[0]).toMatchObject({ kind: "rate_limit", backend: "provider" });
  });

  it("aborts on abort message and skips done", async () => {
    const { port, sent, send } = fakePort();
    let signal: AbortSignal | undefined;
    const translatePage = vi.fn(
      (_j: PageJob, _cb: PageCallbacks, s: AbortSignal) =>
        new Promise<void>((resolve) => {
          signal = s;
          s.addEventListener("abort", () => resolve());
        }),
    );
    attachPagePort(
      port,
      handlersWith(async () => job),
      { translatePage },
    );
    send(translate);
    await tick();
    send({ type: "abort", jobId: "j1" });
    await tick();
    expect(signal?.aborted).toBe(true);
    expect(sent).toEqual([]);
  });

  it("aborts running jobs on disconnect", async () => {
    const { port, send, disconnect } = fakePort();
    let signal: AbortSignal | undefined;
    const translatePage = vi.fn(
      (_j: PageJob, _cb: PageCallbacks, s: AbortSignal) =>
        new Promise<void>((resolve) => {
          signal = s;
          s.addEventListener("abort", () => resolve());
        }),
    );
    attachPagePort(
      port,
      handlersWith(async () => job),
      { translatePage },
    );
    send(translate);
    await tick();
    disconnect();
    expect(signal?.aborted).toBe(true);
  });
});
