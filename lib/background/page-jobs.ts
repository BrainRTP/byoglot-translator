import type { PortToBackground, PortToContent } from "../messaging/page-port";
import type { createTranslationService } from "../translate/service";
import { type Handlers, type Sender, toBackendError } from "./handlers";

export interface PagePort {
  sender?: Sender;
  postMessage(message: PortToContent): void;
  onMessage: { addListener(cb: (message: PortToBackground) => void): void };
  onDisconnect: { addListener(cb: () => void): void };
}

type Service = Pick<ReturnType<typeof createTranslationService>, "translatePage">;

export function attachPagePort(port: PagePort, handlers: Handlers, service: Service): void {
  const jobs = new Map<string, AbortController>();

  const post = (message: PortToContent) => {
    try {
      port.postMessage(message);
    } catch {}
  };

  async function run(msg: Extract<PortToBackground, { type: "translate" }>) {
    const { jobId } = msg;
    jobs.get(jobId)?.abort();
    const controller = new AbortController();
    jobs.set(jobId, controller);
    try {
      const job = await handlers.pageJob(port.sender ?? {}, msg);
      if (controller.signal.aborted) return;
      const backend = await handlers.activeKind();
      await service.translatePage(
        job,
        {
          onResults: (results) => post({ type: "results", jobId, results }),
          onFailed: (ids) => post({ type: "failed", jobId, ids }),
          onFatal: (e) =>
            post({ type: "fatal", jobId, kind: e.kind, retryAfterMs: e.retryAfterMs, backend }),
        },
        controller.signal,
      );
      if (!controller.signal.aborted) post({ type: "done", jobId });
    } catch (error) {
      if (controller.signal.aborted) return;
      const e = toBackendError(error);
      post({
        type: "fatal",
        jobId,
        kind: e.kind,
        retryAfterMs: e.retryAfterMs,
        backend: await handlers.activeKind(),
      });
    } finally {
      if (jobs.get(jobId) === controller) jobs.delete(jobId);
    }
  }

  port.onMessage.addListener((msg) => {
    if (msg.type === "abort") {
      jobs.get(msg.jobId)?.abort();
      jobs.delete(msg.jobId);
    } else if (msg.type === "translate") {
      void run(msg);
    }
  });

  port.onDisconnect.addListener(() => {
    for (const controller of jobs.values()) controller.abort();
    jobs.clear();
  });
}
