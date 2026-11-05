import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PortLike } from "../../../lib/dom/page-translator";
import type { PortToBackground, PortToContent } from "../../../lib/messaging/page-port";
import { createSelectionInserter } from "../../../lib/selection/insert";
import type { DisplayMode } from "../../../lib/settings/types";

type Translate = Extract<PortToBackground, { type: "translate" }>;

function setup(mode: DisplayMode = "replace") {
  const sent: PortToBackground[] = [];
  const listeners: Array<(m: PortToContent) => void> = [];
  const port: PortLike = {
    postMessage: (m) => sent.push(m),
    onMessage: { addListener: (f) => listeners.push(f) },
    disconnect: vi.fn(),
  };
  const emit = (m: PortToContent) => {
    for (const l of listeners) l(m);
  };
  const inserter = createSelectionInserter({
    doc: document,
    connect: () => port,
    getDisplayMode: async () => mode,
  });
  const job = async () => {
    await vi.waitFor(() => expect(sent.length).toBe(1));
    return sent[0] as Translate;
  };
  return { inserter, port, emit, sent, job };
}

function plainHtml(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  for (const m of clone.querySelectorAll("[data-byoglot]")) m.remove();
  return clone.innerHTML;
}

function rangeOf(el: Element): Range {
  const range = document.createRange();
  range.selectNodeContents(el);
  return range;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("createSelectionInserter", () => {
  it("inserts the translation in place and reverts it", async () => {
    document.body.innerHTML = "<p id=p>Hello <b>big</b> world</p>";
    const p = document.getElementById("p") as Element;
    const { inserter, emit, job } = setup();
    const done = inserter.insert(rangeOf(p));
    const m = await job();
    expect(m).toEqual({
      type: "translate",
      jobId: m.jobId,
      segments: [{ id: m.segments[0]?.id, text: "Hello <x1>big</x1> world" }],
      page: { title: document.title, hostname: document.location.hostname },
    });
    emit({
      type: "results",
      jobId: m.jobId,
      results: [
        { id: m.segments[0]?.id as string, text: "Привет <x1>большой</x1> мир", cached: false },
      ],
    });
    emit({ type: "done", jobId: m.jobId });
    await expect(done).resolves.toBe("done");
    expect(plainHtml(p)).toBe("Привет <b>большой</b> мир");
    expect(p.querySelector('[data-byoglot="revert"]')).not.toBeNull();
    inserter.restoreAll();
    expect(p.innerHTML).toBe("Hello <b>big</b> world");
  });

  it("bilingual mode appends an inline translation", async () => {
    document.body.innerHTML = "<p id=p>Hello world</p>";
    const p = document.getElementById("p") as Element;
    const { inserter, emit, job } = setup("bilingual");
    const done = inserter.insert(rangeOf(p));
    const m = await job();
    emit({
      type: "results",
      jobId: m.jobId,
      results: [{ id: m.segments[0]?.id as string, text: "Привет мир", cached: false }],
    });
    emit({ type: "done", jobId: m.jobId });
    await done;
    const span = p.querySelector(
      "span[data-byoglot=''], span[data-byoglot]:not([data-byoglot=revert])",
    );
    expect(span?.textContent).toBe("Привет мир");
    expect((span as HTMLElement).style.display).not.toBe("block");
    expect(p.textContent).toContain("Hello world");
  });

  it("fatal error restores applied blocks and removes the button", async () => {
    document.body.innerHTML = "<p id=a>One</p><p id=b>Two</p>";
    const { inserter, emit, job } = setup();
    const done = inserter.insert(rangeOf(document.body));
    const m = await job();
    emit({
      type: "results",
      jobId: m.jobId,
      results: [{ id: m.segments[0]?.id as string, text: "Один", cached: false }],
    });
    expect(document.getElementById("a")?.textContent).toBe("Один");
    emit({ type: "fatal", jobId: m.jobId, kind: "unauthorized" });
    await expect(done).resolves.toEqual({ error: "unauthorized" });
    expect(document.body.innerHTML).toBe('<p id="a">One</p><p id="b">Two</p>');
  });

  it("detached range resolves empty", async () => {
    document.body.innerHTML = "<p id=p>Hello</p>";
    const p = document.getElementById("p") as Element;
    const range = rangeOf(p);
    p.remove();
    const { inserter, sent } = setup();
    await expect(inserter.insert(range)).resolves.toBe("empty");
    expect(sent).toEqual([]);
  });

  it("failed segments are skipped", async () => {
    document.body.innerHTML = "<p id=p>Hello</p>";
    const p = document.getElementById("p") as Element;
    const { inserter, emit, job } = setup();
    const done = inserter.insert(rangeOf(p));
    const m = await job();
    emit({ type: "failed", jobId: m.jobId, ids: m.segments.map((s) => s.id) });
    emit({ type: "done", jobId: m.jobId });
    await expect(done).resolves.toEqual({ error: "bad_response" });
    expect(p.innerHTML).toBe("Hello");
  });
});
