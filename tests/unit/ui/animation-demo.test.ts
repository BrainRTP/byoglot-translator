import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MARK_ATTR } from "../../../lib/dom/constants";
import type { Animator, Token } from "../../../lib/dom/effects/animator";
import {
  createDemo,
  createHoverLoop,
  createStage,
  type Sample,
} from "../../../lib/ui/animation-demo";

const SAMPLE: Sample = [
  { tag: "h3", en: "Getting started", ru: "Начало работы" },
  {
    tag: "p",
    en: "See the <x1>setup guide</x1> now.",
    ru: "Откройте <x1>руководство</x1> сейчас.",
  },
  { tag: "li", en: "Open a page.", ru: "Откройте страницу." },
];

type Call = { type: "prepare" | "play" | "finishAll"; text?: string; root?: Element };

function fakeAnimator(opts: { animate?: boolean } = {}) {
  const calls: Call[] = [];
  let running = false;
  const animator: Animator = {
    prepare(block) {
      calls.push({ type: "prepare", text: block.textContent ?? "" });
      if (opts.animate === false) return null;
      return { block, from: new Map() } as unknown as Token;
    },
    inView: () => new Set(),
    play(_token, root) {
      calls.push({ type: "play", root });
      running = true;
    },
    finishAll() {
      calls.push({ type: "finishAll" });
      running = false;
    },
    finishWithin() {},
    busy: () => running,
  };
  return { animator, calls, end: () => (running = false) };
}

function texts(host: Element): string[] {
  return [...host.children].flatMap((c) =>
    c.localName === "ul" ? [...c.children].map((li) => li.textContent ?? "") : [c.textContent],
  ) as string[];
}

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createDemo", () => {
  it("builds the english source, keeping the link inside the paragraph", () => {
    createDemo({ host, sample: SAMPLE, animator: fakeAnimator().animator });
    expect(texts(host)).toEqual(["Getting started", "See the setup guide now.", "Open a page."]);
    expect(host.querySelector("p a")?.textContent).toBe("setup guide");
  });

  it("groups list items into one list", () => {
    createDemo({ host, sample: SAMPLE, animator: fakeAnimator().animator });
    expect(host.querySelectorAll("ul > li")).toHaveLength(1);
  });

  it("settles the translation in replace mode and keeps the link", () => {
    const demo = createDemo({ host, sample: SAMPLE, animator: fakeAnimator().animator });
    demo.settle("ru", "replace");
    expect(texts(host)).toEqual([
      "Начало работы",
      "Откройте руководство сейчас.",
      "Откройте страницу.",
    ]);
    expect(host.querySelector("p a")?.textContent).toBe("руководство");
    expect(host.querySelector("h3")?.getAttribute("lang")).toBe("ru");
  });

  it("settles back to the source", () => {
    const demo = createDemo({ host, sample: SAMPLE, animator: fakeAnimator().animator });
    demo.settle("ru", "replace");
    demo.settle("en", "replace");
    expect(texts(host)[0]).toBe("Getting started");
    expect(host.querySelector("h3")?.getAttribute("lang")).toBe("en");
  });

  it("settles bilingual mode with a translation inside every block", () => {
    const demo = createDemo({ host, sample: SAMPLE, animator: fakeAnimator().animator });
    demo.settle("ru", "bilingual");
    const spans = host.querySelectorAll(`[${MARK_ATTR}]`);
    expect(spans).toHaveLength(3);
    expect(spans[0]?.textContent).toBe("Начало работы");
    expect(spans[0]?.getAttribute("lang")).toBe("ru");
    expect(host.querySelector("h3")?.firstChild?.textContent).toBe("Getting started");
    expect(host.dataset.mode).toBe("bilingual");
  });

  it("runs a replace round: prepare sees the old text, play gets the block", () => {
    const { animator, calls } = fakeAnimator();
    const demo = createDemo({ host, sample: SAMPLE, animator });
    demo.settle("ru", "replace");
    calls.length = 0;
    demo.run("en", "replace");
    const prepares = calls.filter((c) => c.type === "prepare");
    expect(prepares.map((c) => c.text)).toEqual([
      "Начало работы",
      "Откройте руководство сейчас.",
      "Откройте страницу.",
    ]);
    const plays = calls.filter((c) => c.type === "play");
    expect(plays.map((c) => c.root?.localName)).toEqual(["h3", "p", "li"]);
    expect(texts(host)[0]).toBe("Getting started");
    expect(demo.busy()).toBe(true);
  });

  it("runs a bilingual round and plays only the translation span", () => {
    const { animator, calls } = fakeAnimator();
    const demo = createDemo({ host, sample: SAMPLE, animator });
    demo.settle("ru", "bilingual");
    calls.length = 0;
    demo.run("ru", "bilingual");
    const plays = calls.filter((c) => c.type === "play");
    expect(plays).toHaveLength(3);
    for (const p of plays) expect(p.root?.hasAttribute(MARK_ATTR)).toBe(true);
    expect(host.querySelectorAll(`[${MARK_ATTR}]`)).toHaveLength(3);
    expect(calls.find((c) => c.type === "prepare")?.text).toBe("Getting started");
  });

  it("applies the text at once when the animator skips the block", () => {
    const { animator, calls } = fakeAnimator({ animate: false });
    const demo = createDemo({ host, sample: SAMPLE, animator });
    demo.settle("ru", "replace");
    demo.run("en", "replace");
    expect(calls.some((c) => c.type === "play")).toBe(false);
    expect(texts(host)[0]).toBe("Getting started");
  });

  it("finishes running effects before it settles and on destroy", () => {
    const { animator, calls } = fakeAnimator();
    const demo = createDemo({ host, sample: SAMPLE, animator });
    calls.length = 0;
    demo.settle("ru", "replace");
    expect(calls[0]?.type).toBe("finishAll");
    calls.length = 0;
    demo.destroy();
    expect(calls.map((c) => c.type)).toEqual(["finishAll"]);
  });
});

describe("createStage", () => {
  function setup() {
    const f = fakeAnimator({ animate: false });
    const demo = createDemo({ host, sample: SAMPLE, animator: f.animator });
    const stage = createStage(demo);
    return { stage, ...f };
  }

  it("starts on the translation", () => {
    setup();
    expect(texts(host)[0]).toBe("Начало работы");
  });

  it("alternates the text on every play", () => {
    const { stage } = setup();
    stage.play();
    expect(texts(host)[0]).toBe("Getting started");
    stage.play();
    expect(texts(host)[0]).toBe("Начало работы");
    stage.play();
    expect(texts(host)[0]).toBe("Getting started");
  });

  it("keeps the source and adds translations in bilingual mode", () => {
    const { stage } = setup();
    stage.setMode("bilingual");
    expect(host.querySelectorAll(`[${MARK_ATTR}]`)).toHaveLength(3);
    stage.play();
    expect(host.querySelectorAll(`[${MARK_ATTR}]`)).toHaveLength(3);
    expect(host.querySelector("h3")?.firstChild?.textContent).toBe("Getting started");
  });

  it("plays when the mode changes, so the new mode is shown in action", () => {
    const { stage, calls } = setup();
    calls.length = 0;
    stage.setMode("bilingual");
    expect(calls.some((c) => c.type === "prepare")).toBe(true);
  });

  it("returns to replace mode on the language it showed before", () => {
    const { stage } = setup();
    stage.play();
    expect(texts(host)[0]).toBe("Getting started");
    stage.setMode("bilingual");
    stage.setMode("replace");
    expect(host.querySelectorAll(`[${MARK_ATTR}]`)).toHaveLength(0);
    expect(host.dataset.mode).toBe("replace");
  });

  it("settle drops running effects and keeps the current state", () => {
    const { stage, calls } = setup();
    stage.play();
    calls.length = 0;
    stage.settle();
    expect(calls[0]?.type).toBe("finishAll");
    expect(texts(host)[0]).toBe("Getting started");
  });
});

describe("createHoverLoop", () => {
  function setup() {
    const f = fakeAnimator();
    const demo = createDemo({ host, sample: SAMPLE, animator: f.animator });
    demo.settle("ru", "replace");
    const loop = createHoverLoop(demo, { pauseMs: 500, pollMs: 100 });
    return { loop, ...f };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("plays at once on start, going from the resting translation to the source", () => {
    const { loop } = setup();
    loop.start();
    expect(texts(host)[0]).toBe("Getting started");
  });

  it("waits for the effect, pauses, then swaps back", () => {
    const { loop, end } = setup();
    loop.start();
    vi.advanceTimersByTime(1000);
    expect(texts(host)[0]).toBe("Getting started");
    end();
    vi.advanceTimersByTime(100);
    expect(texts(host)[0]).toBe("Getting started");
    vi.advanceTimersByTime(500);
    expect(texts(host)[0]).toBe("Начало работы");
  });

  it("ignores a second start while running", () => {
    const { loop, calls } = setup();
    loop.start();
    const n = calls.filter((c) => c.type === "play").length;
    loop.start();
    expect(calls.filter((c) => c.type === "play").length).toBe(n);
  });

  it("stop settles on the translation and cancels the next round", () => {
    const { loop, end, calls } = setup();
    loop.start();
    loop.stop();
    expect(texts(host)[0]).toBe("Начало работы");
    expect(calls.filter((c) => c.type === "finishAll").length).toBeGreaterThan(0);
    end();
    const plays = calls.filter((c) => c.type === "play").length;
    vi.advanceTimersByTime(5000);
    expect(calls.filter((c) => c.type === "play").length).toBe(plays);
    expect(texts(host)[0]).toBe("Начало работы");
  });

  it("restarts from the translation after a stop", () => {
    const { loop } = setup();
    loop.start();
    loop.stop();
    loop.start();
    expect(texts(host)[0]).toBe("Getting started");
  });
});
