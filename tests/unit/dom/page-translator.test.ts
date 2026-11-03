import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { MARK_ATTR } from "../../../lib/dom/constants";
import { registry } from "../../../lib/dom/effects/registry";
import type { AnimationKind, Effect } from "../../../lib/dom/effects/types";
import {
  createPageTranslator,
  type PortLike,
  shareInFlight,
} from "../../../lib/dom/page-translator";
import type { PortToBackground, PortToContent } from "../../../lib/messaging/page-port";
import type { PageState } from "../../../lib/messaging/protocol";
import type { DisplayMode } from "../../../lib/settings/types";

type Translate = Extract<PortToBackground, { type: "translate" }>;

function fakePort(auto = true) {
  const sent: PortToBackground[] = [];
  const listeners: Array<(m: PortToContent) => void> = [];
  const emit = (m: PortToContent) => {
    for (const l of listeners) l(m);
  };
  const disconnectListeners: Array<() => void> = [];
  const port: PortLike = {
    postMessage(m) {
      sent.push(m);
      if (auto && m.type === "translate") {
        queueMicrotask(() => {
          emit({
            type: "results",
            jobId: m.jobId,
            results: m.segments.map((s) => ({ id: s.id, text: `[ru] ${s.text}`, cached: false })),
          });
          emit({ type: "done", jobId: m.jobId });
        });
      }
    },
    onMessage: { addListener: (f) => listeners.push(f) },
    onDisconnect: { addListener: (f) => disconnectListeners.push(f) },
    disconnect: vi.fn(),
  };
  const translates = () => sent.filter((m): m is Translate => m.type === "translate");
  const drop = () => {
    for (const l of disconnectListeners) l();
  };
  return { port, sent, emit, translates, drop };
}

class MockIO {
  static instances: MockIO[] = [];
  static visible: (el: Element) => boolean = () => false;
  static auto = true;
  observed = new Set<Element>();
  pending: Element[] = [];
  disconnect = vi.fn();
  unobserve = vi.fn();
  constructor(
    readonly cb: (entries: Array<{ target: Element; isIntersecting: boolean }>) => void,
    readonly options?: IntersectionObserverInit,
  ) {
    MockIO.instances.push(this);
  }
  observe(el: Element) {
    const fresh = !this.observed.has(el);
    this.observed.add(el);
    if (!fresh || !MockIO.auto) return;
    this.pending.push(el);
    if (this.pending.length > 1) return;
    queueMicrotask(() => {
      const batch = this.pending;
      this.pending = [];
      this.cb(batch.map((target) => ({ target, isIntersecting: MockIO.visible(target) })));
    });
  }
  fire(visible: Element[]) {
    this.cb(visible.map((target) => ({ target, isIntersecting: true })));
  }
}

const live: Array<{ restore(): void }> = [];

type Box = { left: number; top: number; width: number; height: number };

let geometry: MockInstance | null = null;

function mockGeometry(boxOf: (el: Element) => Box | undefined) {
  geometry = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
    this: Element,
  ) {
    const b = boxOf(this) ?? { left: 0, top: 0, width: 0, height: 0 };
    return {
      ...b,
      x: b.left,
      y: b.top,
      right: b.left + b.width,
      bottom: b.top + b.height,
      toJSON: () => ({}),
    } as DOMRect;
  });
}

const MAIN_BOX: Box = { left: 200, top: 0, width: 600, height: 2000 };
const inMain = (el: Element) => el.closest("main") !== null;
const mainOnly = (el: Element) => (inMain(el) ? MAIN_BOX : undefined);

const paragraphs = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => `<p>${prefix} ${i}</p>`).join("");
const sequence = (prefix: string, from: number, to: number) =>
  Array.from({ length: to - from }, (_, i) => `${prefix} ${from + i}`);
const texts = (m: Translate | undefined) => m?.segments.map((s) => s.text);

function setup(
  html: string,
  opts: {
    auto?: boolean;
    mode?: DisplayMode;
    detect?: (t: string) => string;
    animation?: AnimationKind;
  } = {},
) {
  document.body.innerHTML = html;
  const fp = fakePort(opts.auto ?? true);
  const states: PageState[] = [];
  const connect = vi.fn(() => fp.port);
  const detectLanguage = vi.fn(async (text: string) => ({
    lang: opts.detect?.(text) ?? "en",
    reliable: true,
  }));
  const getAnimation = vi.fn(async () => opts.animation ?? "none");
  const translator = createPageTranslator({
    doc: document,
    connect,
    getDisplayMode: async () => opts.mode ?? "replace",
    getAnimation,
    detectLanguage,
    targetLang: async () => "ru-RU",
    onState: (s) => states.push(s),
  });
  live.push(translator);
  return { ...fp, states, connect, detectLanguage, getAnimation, translator };
}

const settle = () => vi.advanceTimersByTimeAsync(0);
const text = (sel: string) => document.querySelector(sel)?.textContent;

beforeEach(() => {
  vi.useFakeTimers();
  MockIO.instances = [];
  MockIO.visible = () => false;
  MockIO.auto = true;
  vi.stubGlobal("IntersectionObserver", MockIO);
});

afterEach(() => {
  for (const t of live.splice(0)) t.restore();
  geometry?.mockRestore();
  geometry = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const FOUR =
  '<p id="a">Alpha one</p><p id="b">Beta two</p><p id="c">Gamma three</p><p id="d">Delta four</p>';

describe("start", () => {
  it("translates visible blocks first and reports growing progress", async () => {
    const t = setup(FOUR);
    MockIO.visible = (el) => el.id === "c" || el.id === "d";
    await t.translator.start();
    await settle();

    const first = t.translates()[0];
    expect(first?.segments.map((s) => s.text)).toEqual([
      "Gamma three",
      "Delta four",
      "Alpha one",
      "Beta two",
    ]);
    expect(MockIO.instances).toHaveLength(1);
    expect(MockIO.instances[0]?.options?.rootMargin).toBe("200px");
    expect(text("#a")).toBe("[ru] Alpha one");
    expect(text("#d")).toBe("[ru] Delta four");

    const dones = t.states.map((s) => s.done);
    expect(dones).toEqual([...dones].sort((x, y) => x - y));
    expect(t.states[0]?.state).toBe("translating");
    expect(t.states.at(-1)).toEqual({ state: "translated", done: 4, total: 4, failed: 0 });
    expect(t.translator.state()).toEqual(t.states.at(-1));
  });

  it("sends in document order when the visibility callback never fires", async () => {
    const t = setup(FOUR);
    MockIO.auto = false;
    const started = t.translator.start();
    await vi.advanceTimersByTimeAsync(99);
    expect(t.translates()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await started;
    await settle();
    expect(t.translates()[0]?.segments.map((s) => s.text)).toEqual([
      "Alpha one",
      "Beta two",
      "Gamma three",
      "Delta four",
    ]);
  });

  it("skips blocks already in the target language and does not count them", async () => {
    const t = setup(
      '<p id="ru">Это предложение уже написано по-русски</p><p id="en">This sentence is written in English</p><p id="short">Привет</p>',
      { detect: (txt) => (/[а-я]/i.test(txt) ? "ru" : "en") },
    );
    await t.translator.start();
    await settle();

    const sent = t.translates().flatMap((m) => m.segments.map((s) => s.text));
    expect(sent).toEqual(["This sentence is written in English", "Привет"]);
    expect(text("#ru")).toBe("Это предложение уже написано по-русски");
    expect(t.translator.state().total).toBe(2);
    expect(t.detectLanguage).toHaveBeenCalledTimes(2);
  });

  it("opens one port per start and counts failed blocks", async () => {
    const t = setup(FOUR, { auto: false });
    await t.translator.start();
    await settle();
    expect(t.connect).toHaveBeenCalledTimes(1);
    const job = t.translates()[0] as Translate;
    const [a, b, c, d] = job.segments;
    t.emit({
      type: "results",
      jobId: job.jobId,
      results: [{ id: a?.id ?? "", text: "A", cached: false }],
    });
    t.emit({ type: "failed", jobId: job.jobId, ids: [b?.id ?? ""] });
    expect(t.translator.state()).toEqual({ state: "translating", done: 1, total: 4, failed: 1 });
    t.emit({
      type: "results",
      jobId: job.jobId,
      results: [
        { id: c?.id ?? "", text: "C", cached: true },
        { id: d?.id ?? "", text: "D", cached: true },
      ],
    });
    t.emit({ type: "done", jobId: job.jobId });
    expect(t.translator.state()).toEqual({ state: "translated", done: 3, total: 4, failed: 1 });
  });

  it("splits into chunks of 10 then 50 and moves a newly visible block to the front", async () => {
    const items = Array.from({ length: 160 }, (_, i) => `<p id="p${i}">Item number ${i}</p>`);
    const t = setup(items.join(""), { auto: false });
    await t.translator.start();
    await settle();

    const sizes = () => t.translates().map((m) => m.segments.length);
    expect(sizes()).toEqual([10, 50]);
    expect(texts(t.translates()[0])).toEqual(sequence("Item number", 0, 10));
    const late = document.getElementById("p150") as Element;
    MockIO.instances[0]?.fire([late]);
    t.emit({ type: "done", jobId: t.translates()[0]?.jobId ?? "" });
    t.emit({ type: "done", jobId: t.translates()[1]?.jobId ?? "" });
    expect(sizes()).toEqual([10, 50, 50, 50]);
    expect(t.translates()[2]?.segments[0]?.text).toBe("Item number 150");
  });
});

describe("lanes", () => {
  it("sends only main blocks first (10), then the side column in the other slot", async () => {
    const t = setup(
      `<div id="side">${paragraphs("Side", 30)}</div><main>${paragraphs("Main", 30)}</main>`,
      { auto: false },
    );
    mockGeometry((el) => {
      if (inMain(el)) return MAIN_BOX;
      if (el.closest("#side")) return { left: 0, top: 0, width: 150, height: 2000 };
      return undefined;
    });
    await t.translator.start();
    await settle();

    expect(t.translates()).toHaveLength(2);
    expect(texts(t.translates()[0])).toEqual(sequence("Main", 0, 10));
    expect(texts(t.translates()[1])).toEqual(sequence("Side", 0, 30));

    t.emit({ type: "done", jobId: t.translates()[0]?.jobId ?? "" });
    expect(texts(t.translates()[2])).toEqual(sequence("Main", 10, 30));
  });

  it("orders blocks inside the main column by position", async () => {
    const t = setup(
      '<main><p data-top="300">Third</p><p data-top="100">First</p><p data-top="200">Second</p></main>',
      { auto: false },
    );
    mockGeometry((el) => {
      if (inMain(el)) return { ...MAIN_BOX, top: Number(el.getAttribute("data-top") ?? 0) };
      return undefined;
    });
    await t.translator.start();
    await settle();
    expect(texts(t.translates()[0])).toEqual(["First", "Second", "Third"]);
  });

  it("sends hidden blocks after the visible ones", async () => {
    const t = setup(
      '<main><p data-hide="1">Hidden</p><p data-top="200">Second</p><p data-top="100">First</p></main>',
      { auto: false },
    );
    mockGeometry((el) => {
      if (!inMain(el) || el.hasAttribute("data-hide")) return undefined;
      return { ...MAIN_BOX, top: Number(el.getAttribute("data-top") ?? 0) };
    });
    await t.translator.start();
    await settle();
    expect(texts(t.translates()[0])).toEqual(["First", "Second", "Hidden"]);
  });

  it("puts the right block first on an rtl page", async () => {
    document.documentElement.dir = "rtl";
    const t = setup('<main><p data-left="200">Left</p><p data-left="600">Right</p></main>', {
      auto: false,
    });
    mockGeometry((el) => {
      if (!inMain(el)) return undefined;
      return { ...MAIN_BOX, left: Number(el.getAttribute("data-left") ?? 200), width: 100, top: 0 };
    });
    try {
      await t.translator.start();
      await settle();
      expect(texts(t.translates()[0])).toEqual(["Right", "Left"]);
    } finally {
      document.documentElement.removeAttribute("dir");
    }
  });

  it("keeps document order without main and with zero geometry", async () => {
    const t = setup(`<div>${paragraphs("A", 3)}</div><div>${paragraphs("B", 3)}</div>`, {
      auto: false,
    });
    mockGeometry(() => undefined);
    await t.translator.start();
    await settle();
    expect(t.translates()).toHaveLength(1);
    expect(texts(t.translates()[0])).toEqual(["A 0", "A 1", "A 2", "B 0", "B 1", "B 2"]);
  });

  it("puts content added inside main into the main lane and outside it into the side lane", async () => {
    const t = setup(
      `<div id="side">${paragraphs("Side", 2)}</div><main>${paragraphs("Main", 2)}</main>`,
      { auto: false },
    );
    mockGeometry(mainOnly);
    await t.translator.start();
    await settle();
    const [mainJob, sideJob] = t.translates();
    expect(texts(mainJob)).toEqual(["Main 0", "Main 1"]);
    expect(texts(sideJob)).toEqual(["Side 0", "Side 1"]);

    document.querySelector("main")?.insertAdjacentHTML("beforeend", "<p>Late main</p>");
    document.getElementById("side")?.insertAdjacentHTML("beforeend", "<p>Late side</p>");
    await vi.advanceTimersByTimeAsync(300);
    await settle();
    expect(t.translates()).toHaveLength(2);

    t.emit({ type: "done", jobId: sideJob?.jobId ?? "" });
    expect(texts(t.translates()[2])).toEqual(["Late side"]);
    t.emit({ type: "done", jobId: mainJob?.jobId ?? "" });
    expect(texts(t.translates()[3])).toEqual(["Late main"]);
  });

  it("recomputes the main root after the page replaces it", async () => {
    const t = setup(
      `<div id="side">${paragraphs("Side", 2)}</div><main>${paragraphs("Old main column text", 2)}</main>`,
      { auto: false },
    );
    mockGeometry(mainOnly);
    await t.translator.start();
    await settle();
    const [mainJob, sideJob] = t.translates();

    document.querySelector("main")?.remove();
    document.body.insertAdjacentHTML(
      "beforeend",
      `<main>${paragraphs("New main column text", 2)}</main>`,
    );
    document.getElementById("side")?.insertAdjacentHTML("beforeend", "<p>Late side</p>");
    await vi.advanceTimersByTimeAsync(300);
    await settle();
    expect(t.translates()).toHaveLength(2);

    t.emit({ type: "done", jobId: sideJob?.jobId ?? "" });
    expect(texts(t.translates()[2])).toEqual(["Late side"]);
    t.emit({ type: "done", jobId: mainJob?.jobId ?? "" });
    expect(texts(t.translates()[3])).toEqual(["New main column text 0", "New main column text 1"]);
  });

  it("starts the next run with a small first main chunk again", async () => {
    const t = setup(
      `<div id="side">${paragraphs("Side", 30)}</div><main>${paragraphs("Main", 30)}</main>`,
      { auto: false },
    );
    mockGeometry(mainOnly);
    await t.translator.start();
    await settle();
    expect(t.translates()[0]?.segments).toHaveLength(10);

    t.translator.restore();
    await t.translator.start();
    await settle();
    expect(t.translates()).toHaveLength(4);
    expect(texts(t.translates()[2])).toEqual(sequence("Main", 0, 10));
  });
});

describe("mutations", () => {
  it("translates added content after one debounce and ignores its own writes", async () => {
    const t = setup(FOUR);
    await t.translator.start();
    await settle();
    expect(t.translates()).toHaveLength(1);

    document.body.insertAdjacentHTML("beforeend", "<div><p>New text</p></div>");
    await vi.advanceTimersByTimeAsync(299);
    expect(t.translates()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(t.translates()).toHaveLength(2);
    expect(t.translates()[1]?.segments.map((s) => s.text)).toEqual(["New text"]);
    expect(t.translator.state()).toMatchObject({ state: "translated", done: 5, total: 5 });

    await vi.advanceTimersByTimeAsync(3000);
    expect(t.translates()).toHaveLength(2);
  });

  it("watches open shadow roots found during extraction", async () => {
    const t = setup('<p id="a">Alpha one</p><div id="host"></div>');
    const root = (document.getElementById("host") as HTMLElement).attachShadow({ mode: "open" });
    root.innerHTML = "<p>Inside shadow</p>";
    await t.translator.start();
    await settle();
    expect(t.translates()[0]?.segments.map((s) => s.text)).toContain("Inside shadow");

    const added = document.createElement("p");
    added.textContent = "Added in shadow";
    root.append(added);
    await vi.advanceTimersByTimeAsync(300);
    await settle();
    expect(t.translates()).toHaveLength(2);
    expect(t.translates()[1]?.segments.map((s) => s.text)).toEqual(["Added in shadow"]);
  });

  it("does not react to bilingual output nodes", async () => {
    const t = setup(FOUR, { mode: "bilingual" });
    await t.translator.start();
    await settle();
    expect(document.querySelectorAll(`[${MARK_ATTR}]`)).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(3000);
    expect(t.translates()).toHaveLength(1);

    const mark = document.querySelector(`[${MARK_ATTR}]`) as Element;
    mark.append(document.createTextNode(" more text here"));
    await vi.advanceTimersByTimeAsync(3000);
    expect(t.translates()).toHaveLength(1);
  });

  it("re-translates a block once after the page replaces its text", async () => {
    const t = setup('<p id="p">Hello world</p>');
    await t.translator.start();
    await settle();
    expect(text("#p")).toBe("[ru] Hello world");

    const p = document.getElementById("p") as HTMLElement;
    p.textContent = "Other";
    await vi.advanceTimersByTimeAsync(300);
    await settle();
    expect(t.translates()).toHaveLength(2);
    expect(t.translates()[1]?.segments.map((s) => s.text)).toEqual(["Other"]);
    expect(text("#p")).toBe("[ru] Other");

    p.textContent = "[ru] Other";
    (p.firstChild as Text).data = "[ru] Other";
    await vi.advanceTimersByTimeAsync(5 * 300);
    expect(t.translates()).toHaveLength(2);
    expect(t.translator.state()).toMatchObject({ state: "translated", done: 1, total: 1 });
  });

  it("keeps the page value when it updates a translated text node", async () => {
    const t = setup('<p id="p">Hello world</p>');
    await t.translator.start();
    await settle();

    const node = (document.getElementById("p") as HTMLElement).firstChild as Text;
    node.data = "Fresh value";
    await vi.advanceTimersByTimeAsync(300);
    await settle();
    expect(t.translates()).toHaveLength(2);
    expect(t.translates()[1]?.segments.map((s) => s.text)).toEqual(["Fresh value"]);
    expect(text("#p")).toBe("[ru] Fresh value");
  });

  it("stops re-translating a block that keeps changing", async () => {
    const t = setup('<p id="p">Hello world</p>');
    await t.translator.start();
    await settle();

    const p = document.getElementById("p") as HTMLElement;
    for (const value of ["One", "Two", "Three"]) {
      p.textContent = value;
      await vi.advanceTimersByTimeAsync(300);
      await settle();
    }
    expect(t.translates()).toHaveLength(3);
    expect(text("#p")).toBe("Three");
    await vi.advanceTimersByTimeAsync(5 * 300);
    expect(t.translates()).toHaveLength(3);

    for (const value of ["Four", "Five"]) {
      p.textContent = value;
      await vi.advanceTimersByTimeAsync(300);
      await settle();
    }
    expect(t.translates()).toHaveLength(3);
    expect(text("#p")).toBe("Five");

    await vi.advanceTimersByTimeAsync(10_000);
    p.textContent = "Six";
    await vi.advanceTimersByTimeAsync(300);
    await settle();
    expect(t.translates()).toHaveLength(4);
    expect(text("#p")).toBe("[ru] Six");
  });

  it("forgets blocks of removed elements, like a virtualized list does", async () => {
    const t = setup(
      '<div id="list"><p>Item one text</p><p>Item two text</p><p>Item three text</p><p>Item four text</p></div>',
    );
    await t.translator.start();
    await settle();
    expect(t.translator.state()).toMatchObject({ state: "translated", done: 4, total: 4 });

    const list = document.getElementById("list") as HTMLElement;
    list.firstElementChild?.remove();
    list.firstElementChild?.remove();
    await vi.advanceTimersByTimeAsync(300);
    await settle();
    expect(t.translator.state()).toMatchObject({ state: "translated", done: 2, total: 2 });

    list.insertAdjacentHTML("beforeend", "<p>Item five text</p>");
    await vi.advanceTimersByTimeAsync(300);
    await settle();
    expect(t.translator.state()).toMatchObject({ state: "translated", done: 3, total: 3 });
    expect(t.translates()).toHaveLength(2);

    t.translator.restore();
    expect(t.translator.state()).toMatchObject({ state: "idle", total: 0 });
  });

  it("drops a removed element that is still in flight without counting it", async () => {
    const t = setup('<p id="a">Alpha one</p><p id="b">Beta two</p>', { auto: false });
    await t.translator.start();
    await settle();
    const job = t.translates()[0] as Translate;
    document.getElementById("a")?.remove();
    await vi.advanceTimersByTimeAsync(300);
    t.emit({
      type: "results",
      jobId: job.jobId,
      results: job.segments.map((s) => ({ id: s.id, text: `[ru] ${s.text}`, cached: false })),
    });
    t.emit({ type: "done", jobId: job.jobId });
    await settle();
    expect(t.translator.state()).toMatchObject({ state: "translated", done: 1, total: 1 });
    expect(text("#b")).toBe("[ru] Beta two");
  });

  it("keeps the changes for the next flush when a flush throws", async () => {
    const t = setup('<p id="a">Alpha one</p>');
    await t.translator.start();
    await settle();

    const host = document.createElement("span");
    host.innerHTML = "<p>Fresh text</p>";
    vi.spyOn(host, "querySelector").mockImplementationOnce(() => {
      throw new Error("boom");
    });
    document.body.append(host);
    await vi.advanceTimersByTimeAsync(300);
    await settle();
    expect(t.translates()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(300);
    await settle();
    expect(t.translates()).toHaveLength(2);
    expect(t.translates()[1]?.segments.map((s) => s.text)).toEqual(["Fresh text"]);
    expect(t.translator.state().state).toBe("translated");
  });

  it.each<DisplayMode>(["replace", "bilingual"])(
    "restores a detached translated block so a reattached node is translated afresh (%s)",
    async (mode) => {
      const t = setup(FOUR, { mode });
      await t.translator.start();
      await settle();
      expect(t.translates()).toHaveLength(1);

      const node = document.getElementById("b") as HTMLElement;
      node.remove();
      await vi.advanceTimersByTimeAsync(300);
      await settle();
      expect(node.textContent).toBe("Beta two");
      expect(node.querySelector(`[${MARK_ATTR}]`)).toBeNull();

      document.getElementById("a")?.after(node);
      await vi.advanceTimersByTimeAsync(300);
      await settle();
      expect(t.translates()).toHaveLength(2);
      expect(t.translates()[1]?.segments.map((s) => s.text)).toEqual(["Beta two"]);
      expect(node.querySelectorAll(`[${MARK_ATTR}]`)).toHaveLength(mode === "bilingual" ? 1 : 0);
      expect(t.translator.state()).toMatchObject({ state: "translated", done: 4, total: 4 });

      t.translator.restore();
      expect(document.body.innerHTML).toBe(FOUR);
    },
  );
});

describe("shareInFlight", () => {
  it("shares one call between concurrent callers and calls again afterwards", async () => {
    vi.useRealTimers();
    const fn = vi.fn(async () => "v");
    const shared = shareInFlight(fn);
    await Promise.all([shared(), shared()]);
    expect(fn).toHaveBeenCalledTimes(1);
    await shared();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("stop, restore, fatal", () => {
  it("stop aborts pending jobs and goes idle when nothing was applied", async () => {
    const t = setup(FOUR, { auto: false });
    await t.translator.start();
    await settle();
    const job = t.translates()[0] as Translate;

    t.translator.stop();
    expect(t.sent).toContainEqual({ type: "abort", jobId: job.jobId });
    expect(t.translator.state().state).toBe("idle");
    expect(t.port.disconnect).toHaveBeenCalled();

    document.body.insertAdjacentHTML("beforeend", "<p>Later text</p>");
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.translates()).toHaveLength(1);
  });

  it("stop keeps applied translations and partial counts", async () => {
    const t = setup(FOUR, { auto: false });
    await t.translator.start();
    await settle();
    const job = t.translates()[0] as Translate;
    t.emit({
      type: "results",
      jobId: job.jobId,
      results: [{ id: job.segments[0]?.id ?? "", text: "Альфа", cached: false }],
    });

    t.translator.stop();
    expect(t.translator.state()).toEqual({ state: "translated", done: 1, total: 1, failed: 0 });
    expect(text("#a")).toBe("Альфа");

    t.emit({
      type: "results",
      jobId: job.jobId,
      results: [{ id: job.segments[1]?.id ?? "", text: "Бета", cached: false }],
    });
    expect(text("#b")).toBe("Beta two");
  });

  it("restore puts the page back, drops the observer and goes idle", async () => {
    const t = setup(FOUR, { mode: "bilingual" });
    await t.translator.start();
    await settle();
    const original = FOUR;

    t.translator.restore();
    expect(document.body.innerHTML).toBe(original);
    expect(t.translator.state()).toEqual({ state: "idle", done: 0, total: 0, failed: 0 });
    expect(t.port.disconnect).toHaveBeenCalled();
    expect(MockIO.instances[0]?.disconnect).toHaveBeenCalled();

    document.body.insertAdjacentHTML("beforeend", "<p>After restore</p>");
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.translates()).toHaveLength(1);
  });

  it("can start again after restore", async () => {
    const t = setup(FOUR);
    await t.translator.start();
    await settle();
    t.translator.restore();
    await t.translator.start();
    await settle();
    expect(t.translates()).toHaveLength(2);
    expect(t.connect).toHaveBeenCalledTimes(2);
    expect(t.translator.state()).toMatchObject({ state: "translated", done: 4 });
  });

  it("fatal sets error, aborts jobs and ignores everything after it", async () => {
    const items = Array.from({ length: 120 }, (_, i) => `<p id="p${i}">Item number ${i}</p>`);
    const t = setup(items.join(""), { auto: false });
    await t.translator.start();
    await settle();
    const [j1, j2] = t.translates() as [Translate, Translate];

    t.emit({ type: "fatal", jobId: j1.jobId, kind: "rate_limit", retryAfterMs: 5000 });
    expect(t.translator.state()).toMatchObject({
      state: "error",
      error: { kind: "rate_limit", retryAfterMs: 5000 },
    });
    expect(t.sent).toContainEqual({ type: "abort", jobId: j1.jobId });
    expect(t.sent).toContainEqual({ type: "abort", jobId: j2.jobId });

    t.emit({ type: "done", jobId: j1.jobId });
    t.emit({
      type: "results",
      jobId: j1.jobId,
      results: [{ id: j1.segments[0]?.id ?? "", text: "late", cached: false }],
    });
    expect(t.translator.state().state).toBe("error");
    expect(text("#p0")).toBe("Item number 0");
    expect(t.translates()).toHaveLength(2);
  });

  it("reports offline when the port drops with pending jobs and reconnects on the next start", async () => {
    const t = setup(FOUR, { auto: false });
    await t.translator.start();
    await settle();
    const job = t.translates()[0] as Translate;

    t.drop();
    expect(t.translator.state()).toMatchObject({ state: "error", error: { kind: "offline" } });
    t.emit({ type: "done", jobId: job.jobId });
    expect(t.translator.state().state).toBe("error");

    await t.translator.start();
    await settle();
    expect(t.connect).toHaveBeenCalledTimes(2);
    expect(t.translates()).toHaveLength(2);
    expect(t.translator.state().state).toBe("translating");
  });

  it("ignores a port drop when nothing is pending and reconnects lazily", async () => {
    const t = setup('<p id="a">Alpha one</p>');
    await t.translator.start();
    await settle();
    expect(t.translator.state().state).toBe("translated");

    t.drop();
    expect(t.translator.state().state).toBe("translated");
    document.body.insertAdjacentHTML("beforeend", "<p>New text</p>");
    await vi.advanceTimersByTimeAsync(300);
    await settle();
    expect(t.connect).toHaveBeenCalledTimes(2);
    expect(text("p:last-child")).toBe("[ru] New text");
  });

  it("start after an error translates from scratch", async () => {
    const t = setup(FOUR, { auto: false });
    await t.translator.start();
    await settle();
    const job = t.translates()[0] as Translate;
    t.emit({ type: "fatal", jobId: job.jobId, kind: "offline" });
    await t.translator.start();
    await settle();
    expect(t.translates()).toHaveLength(2);
    expect(t.translator.state()).toMatchObject({ state: "translating", total: 4 });
  });
});

describe("animation", () => {
  const MID = "~mid~";
  const FRAMES = 3;
  let saved: Effect | undefined;
  let queue: FrameRequestCallback[] = [];
  let started = 0;
  let finished = 0;

  const effect: Effect = {
    kind: "fade",
    heavy: false,
    start(ctx) {
      started++;
      for (const c of ctx.changes) ctx.write(c.node, MID);
      let n = 0;
      return () => {
        if (++n < FRAMES) return true;
        for (const c of ctx.changes) ctx.write(c.node, c.to);
        return false;
      };
    },
    finish(ctx) {
      finished++;
      for (const c of ctx.changes) ctx.write(c.node, c.to);
    },
  };

  const tick = () => {
    const run = queue;
    queue = [];
    for (const cb of run) cb(0);
  };

  const inViewport = () => mockGeometry(() => ({ left: 0, top: 10, width: 300, height: 20 }));

  beforeEach(() => {
    saved = registry.fade;
    registry.fade = effect;
    queue = [];
    started = 0;
    finished = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => queue.push(cb));
  });

  afterEach(() => {
    registry.fade = saved;
    vi.restoreAllMocks();
  });

  it("asks for the animation kind on start", async () => {
    const t = setup(FOUR, { animation: "fade" });
    expect(t.getAnimation).not.toHaveBeenCalled();
    await t.translator.start();
    await settle();
    expect(t.getAnimation).toHaveBeenCalledTimes(1);
  });

  it("leaves the DOM exactly as before when the animation is none", async () => {
    inViewport();
    const t = setup(FOUR, { animation: "none" });
    await t.translator.start();
    await settle();
    expect(started).toBe(0);
    expect(queue).toHaveLength(0);
    expect(text("#a")).toBe("[ru] Alpha one");
    expect(text("#d")).toBe("[ru] Delta four");
  });

  it("starts the effect synchronously on apply and settles on the final text", async () => {
    inViewport();
    const t = setup(FOUR, { animation: "fade" });
    await t.translator.start();
    await settle();
    expect(started).toBe(4);
    expect(text("#a")).toBe(MID);
    expect(queue.length).toBeGreaterThan(0);

    for (let i = 0; i < FRAMES + 1; i++) tick();
    expect(text("#a")).toBe("[ru] Alpha one");
    expect(text("#d")).toBe("[ru] Delta four");
    expect(t.translator.state()).toMatchObject({ state: "translated", done: 4, total: 4 });
  });

  it("changes blocks instantly when they are outside the viewport", async () => {
    const t = setup(FOUR, { animation: "fade" });
    await t.translator.start();
    await settle();
    expect(started).toBe(0);
    expect(queue).toHaveLength(0);
    expect(text("#a")).toBe("[ru] Alpha one");
  });

  it("animates only the inserted span in bilingual mode", async () => {
    inViewport();
    const t = setup(FOUR, { animation: "fade", mode: "bilingual" });
    await t.translator.start();
    await settle();
    expect(started).toBe(4);
    const a = document.getElementById("a") as HTMLElement;
    expect(a.firstChild?.textContent).toBe("Alpha one");
    expect(a.querySelector(`[${MARK_ATTR}]`)?.textContent).toBe(MID);
    for (let i = 0; i < FRAMES + 1; i++) tick();
    expect(a.querySelector(`[${MARK_ATTR}]`)?.textContent).toBe("[ru] Alpha one");
    expect(a.firstChild?.textContent).toBe("Alpha one");
  });

  it.each<DisplayMode>(["replace", "bilingual"])(
    "restore during an animation brings back the original, not a frame (%s)",
    async (mode) => {
      inViewport();
      const t = setup(FOUR, { animation: "fade", mode });
      await t.translator.start();
      await settle();
      expect(started).toBe(4);
      expect(document.body.textContent).toContain(MID);

      t.translator.restore();
      expect(document.body.innerHTML).toBe(FOUR);
      expect(finished).toBe(4);
    },
  );

  it("stop during an animation keeps the final translation", async () => {
    inViewport();
    const t = setup(FOUR, { animation: "fade" });
    await t.translator.start();
    await settle();
    expect(text("#a")).toBe(MID);

    t.translator.stop();
    expect(text("#a")).toBe("[ru] Alpha one");
    expect(text("#d")).toBe("[ru] Delta four");
    expect(finished).toBe(4);
  });

  it("reads every block rect of a batch before the first apply", async () => {
    let applied = false;
    const reads: boolean[] = [];
    mockGeometry(() => {
      reads.push(applied);
      return { left: 0, top: 10, width: 300, height: 20 };
    });
    const t = setup(FOUR, { animation: "fade", auto: false });
    await t.translator.start();
    await settle();
    const job = t.translates()[0] as Translate;
    reads.length = 0;
    const original = Object.getOwnPropertyDescriptor(CharacterData.prototype, "data");
    const spy = vi.spyOn(Text.prototype, "data", "set").mockImplementation(function (
      this: Text,
      v: string,
    ) {
      applied = true;
      original?.set?.call(this, v);
    });
    const results = job.segments.map((s) => ({ id: s.id, text: "Ru", cached: false }));
    t.emit({ type: "results", jobId: job.jobId, results });
    spy.mockRestore();
    expect(started).toBe(4);
    expect(applied).toBe(true);
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((r) => !r)).toBe(true);
  });

  it("releasing one block leaves the animation of another running", async () => {
    inViewport();
    const t = setup(FOUR, { animation: "fade" });
    await t.translator.start();
    await settle();
    expect(started).toBe(4);

    document.getElementById("a")?.append(" more");
    await vi.advanceTimersByTimeAsync(300);
    expect(finished).toBe(1);
    expect(text("#b")).toBe(MID);
    expect(text("#d")).toBe(MID);
  });

  it("removing one block finishes only its own animation", async () => {
    inViewport();
    const t = setup(FOUR, { animation: "fade" });
    await t.translator.start();
    await settle();
    expect(started).toBe(4);

    document.getElementById("a")?.remove();
    await vi.advanceTimersByTimeAsync(300);
    expect(finished).toBe(1);
    expect(text("#b")).toBe(MID);
    expect(text("#d")).toBe(MID);
  });

  it("frames do not wake the watcher into a new translation", async () => {
    inViewport();
    const t = setup(FOUR, { animation: "fade" });
    await t.translator.start();
    await settle();
    for (let i = 0; i < FRAMES + 1; i++) {
      tick();
      await vi.advanceTimersByTimeAsync(400);
    }
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.translates()).toHaveLength(1);
    expect(t.translator.state()).toMatchObject({ state: "translated", done: 4, total: 4 });
  });

  it("finishes the old animation before a block is translated again", async () => {
    inViewport();
    const t = setup(FOUR, { animation: "fade", auto: false });
    await t.translator.start();
    await settle();
    const job = t.translates()[0] as Translate;
    const idA = job.segments.find((s) => s.text === "Alpha one")?.id ?? "";
    t.emit({
      type: "results",
      jobId: job.jobId,
      results: [{ id: idA, text: "Альфа", cached: false }],
    });
    expect(text("#a")).toBe(MID);

    document.getElementById("a")?.append(" more");
    await vi.advanceTimersByTimeAsync(300);
    await settle();
    expect(finished).toBe(1);
    expect(text("#a")).toBe("Alpha one more");
    const second = t.translates()[1] as Translate;
    expect(second.segments.map((s) => s.text)).toEqual(["Alpha one more"]);

    t.emit({
      type: "results",
      jobId: second.jobId,
      results: [{ id: second.segments[0]?.id ?? "", text: "Альфа еще", cached: false }],
    });
    for (let i = 0; i < FRAMES + 1; i++) tick();
    expect(text("#a")).toBe("Альфа еще");
  });
});
