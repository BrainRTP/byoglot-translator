import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAnimator } from "../../../../lib/dom/effects/animator";
import { penEffect } from "../../../../lib/dom/effects/pen";
import { availableKinds, registry } from "../../../../lib/dom/effects/registry";
import type { EffectContext, Overlay } from "../../../../lib/dom/effects/types";

type Call = { op: string; args: number[]; alpha: number };

function fakeCanvas() {
  const calls: Call[] = [];
  const g = { globalAlpha: 1, fillStyle: "", font: "", textBaseline: "", textAlign: "" };
  const rec =
    (op: string) =>
    (...args: unknown[]) => {
      calls.push({
        op,
        args: args.filter((a): a is number => typeof a === "number"),
        alpha: g.globalAlpha,
      });
    };
  const ctx = new Proxy(g as unknown as CanvasRenderingContext2D, {
    get(_target, prop: string) {
      if (prop in g) return (g as Record<string, unknown>)[prop];
      return rec(prop);
    },
    set(_target, prop: string, value) {
      (g as Record<string, unknown>)[prop] = value;
      return true;
    },
  });
  return { ctx, calls, of: (op: string) => calls.filter((c) => c.op === op) };
}

type Anim = {
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
  cancel: ReturnType<typeof vi.fn>;
};

let anims: Anim[];
let savedAnimate: unknown;

beforeEach(() => {
  anims = [];
  savedAnimate = (Element.prototype as { animate?: unknown }).animate;
  (Element.prototype as { animate?: unknown }).animate = vi.fn(
    (keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
      const a: Anim = { keyframes, options, cancel: vi.fn() };
      anims.push(a);
      return a;
    },
  );
});

// animators started by a test are finished so the shared overlay does not leak into the next one
const animators: Array<{ finishAll(): void }> = [];

afterEach(() => {
  for (const a of animators.splice(0)) a.finishAll();
  (Element.prototype as { animate?: unknown }).animate = savedAnimate;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function r(left: number, top: number, width: number, height: number): DOMRect {
  return new DOMRect(left, top, width, height);
}

// Range rects by the text the range covers: single words (before) or whole nodes (lines)
function stubRects(byText: Record<string, DOMRect[]>) {
  vi.spyOn(Range.prototype, "getClientRects").mockImplementation(function (this: Range) {
    return (byText[this.toString()] ?? []) as unknown as DOMRectList;
  });
}

function lcg(seed = 7) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

type Harness = {
  ctx: EffectContext;
  node: Text;
  layer: HTMLElement;
  released: () => number;
  canvasCalls: () => number;
  writes: string[];
  setNow(t: number): void;
};

function setup(opts: {
  oldText: string;
  newText: string;
  blockRect?: DOMRect;
  bilingual?: boolean;
  canvas?: ReturnType<typeof fakeCanvas> | null;
  noOverlay?: boolean;
  random?: () => number;
  top?: number;
}): Harness & { block: HTMLElement } {
  const block = document.createElement("p");
  block.textContent = opts.oldText;
  document.body.append(block);
  const blockRect = opts.blockRect ?? r(0, opts.top ?? 100, 300, 40);
  vi.spyOn(block, "getBoundingClientRect").mockReturnValue(blockRect);
  const node = block.firstChild as Text;
  const layer = document.createElement("div");
  document.body.append(layer);
  let t = 1000;
  let released = 0;
  let canvasCalls = 0;
  const writes: string[] = [];
  const overlay: Overlay = {
    canvas: () => {
      canvasCalls++;
      return opts.canvas === undefined || opts.canvas === null ? null : opts.canvas.ctx;
    },
    layer: () => layer,
    beginFrame: () => {},
    release: () => {
      released++;
    },
  };
  const ctx: EffectContext = {
    block,
    changes: [{ node, from: opts.oldText, to: opts.newText }],
    bilingual: opts.bilingual ?? false,
    write(n, value) {
      writes.push(value);
      n.data = value;
      return true;
    },
    overlay: () => (opts.noOverlay ? null : overlay),
    now: () => t,
    random: opts.random ?? lcg(),
  };
  return {
    ctx,
    node,
    block,
    layer,
    released: () => released,
    canvasCalls: () => canvasCalls,
    writes,
    setNow: (v) => {
      t = v;
    },
  };
}

// the old text sits in the DOM for before(), then the translation lands
function begin(h: Harness & { block: HTMLElement }, newText: string, linesRects: DOMRect[]) {
  const prepared = penEffect.before?.(h.block, { bilingual: false });
  h.node.data = newText;
  stubRects({ ...currentWords, [newText]: linesRects });
  const frame = penEffect.start(h.ctx, prepared);
  return { frame, prepared };
}

let currentWords: Record<string, DOMRect[]> = {};

describe("registry", () => {
  it("registers pen and marks it as an overlay effect", () => {
    expect(registry.pen).toBe(penEffect);
    expect(penEffect.usesOverlay).toBe(true);
    expect(availableKinds()).toContain("pen");
  });
});

describe("before", () => {
  it("does not measure words in bilingual mode", () => {
    const p = document.createElement("p");
    p.textContent = "old words";
    document.body.append(p);
    const spy = vi.spyOn(Range.prototype, "getClientRects");
    const prepared = penEffect.before?.(p, { bilingual: true }) as { words: unknown[] };
    expect(prepared.words).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("measures old words with their font and color", () => {
    document.body.innerHTML = '<p style="color: rgb(10, 20, 30); font-size: 18px">old words</p>';
    stubRects({ old: [r(10, 100, 30, 20)], words: [r(45, 100, 50, 20)] });
    const p = document.body.firstElementChild as Element;
    const prepared = penEffect.before?.(p, { bilingual: false }) as {
      words: Array<Record<string, unknown>>;
    };
    expect(prepared.words).toHaveLength(2);
    expect(prepared.words[0]).toMatchObject({ text: "old", left: 10, top: 100, width: 30 });
    expect(prepared.words[1]).toMatchObject({ text: "words", left: 45 });
    expect(prepared.words[0]?.color).toBe("rgb(10, 20, 30)");
    expect(String(prepared.words[0]?.font)).toContain("18px");
  });

  it("takes at most 400 words", () => {
    const text = Array.from({ length: 500 }, (_, i) => `w${i}`).join(" ");
    document.body.innerHTML = `<p>${text}</p>`;
    vi.spyOn(Range.prototype, "getClientRects").mockImplementation(
      () => [r(10, 100, 20, 20)] as unknown as DOMRectList,
    );
    const prepared = penEffect.before?.(document.body.firstElementChild as Element, {
      bilingual: false,
    }) as {
      words: unknown[];
    };
    expect(prepared.words).toHaveLength(400);
  });

  it("skips words that are not rendered or far outside the viewport", () => {
    document.body.innerHTML = "<p>hidden shown below</p>";
    stubRects({
      hidden: [],
      shown: [r(10, 100, 30, 20)],
      below: [r(10, window.innerHeight + 500, 30, 20)],
    });
    const prepared = penEffect.before?.(document.body.firstElementChild as Element, {
      bilingual: false,
    }) as {
      words: Array<{ text: string }>;
    };
    expect(prepared.words.map((w) => w.text)).toEqual(["shown"]);
  });
});

describe("fallback to fade", () => {
  it("uses fade when there is no overlay", () => {
    const h = setup({ oldText: "old text", newText: "new text", noOverlay: true });
    currentWords = { old: [r(10, 100, 30, 20)], text: [r(45, 100, 30, 20)] };
    stubRects(currentWords);
    const prepared = penEffect.before?.(h.block, { bilingual: false });
    h.node.data = "new text";
    const frame = penEffect.start(h.ctx, prepared);
    expect(anims).toHaveLength(1);
    expect(anims[0]?.keyframes).toEqual([{ opacity: 1 }, { opacity: 0 }]);
    expect(h.layer.childElementCount).toBe(0);
    h.setNow(1000 + 180);
    expect(frame(1180)).toBe(true);
    penEffect.finish(h.ctx);
    expect(anims.every((a) => a.cancel.mock.calls.length === 1)).toBe(true);
    expect(h.node.data).toBe("new text");
  });

  it("uses fade when the canvas has no 2d context (happy-dom)", () => {
    const h = setup({ oldText: "old text", newText: "new text", canvas: null });
    currentWords = { old: [r(10, 100, 30, 20)], text: [r(45, 100, 30, 20)] };
    stubRects(currentWords);
    const prepared = penEffect.before?.(h.block, { bilingual: false });
    h.node.data = "new text";
    penEffect.start(h.ctx, prepared);
    expect(anims[0]?.keyframes).toEqual([{ opacity: 1 }, { opacity: 0 }]);
    expect(h.layer.childElementCount).toBe(0);
    expect(h.released()).toBe(1);
    penEffect.finish(h.ctx);
    expect(h.node.data).toBe("new text");
  });
});

describe("dust phase", () => {
  const WORDS = { old: [r(10, 100, 30, 20)], text: [r(45, 100, 40, 20)] };

  function dust(canvas = fakeCanvas()) {
    const h = setup({ oldText: "old text", newText: "new text", canvas });
    currentWords = WORDS;
    stubRects(WORDS);
    const lines = [r(10, 100, 200, 20)];
    const { frame } = begin(h, "new text", lines);
    return { h, canvas, frame, lines };
  }

  it("hides the block with opacity 0 right after start and draws old words", () => {
    const { canvas } = dust();
    expect(anims).toHaveLength(1);
    expect(anims[0]?.keyframes.every((k) => k.opacity === 0)).toBe(true);
    expect(anims[0]?.options.fill).toBe("forwards");
    expect(canvas.of("fillText").length).toBeGreaterThan(0);
  });

  it("makes 6-14 particles of 1.5-3px per word", () => {
    const canvas = fakeCanvas();
    const { frame } = dust(canvas);
    canvas.calls.length = 0;
    frame(1100);
    const fills = canvas.of("fillRect");
    expect(fills.length).toBeGreaterThanOrEqual(12);
    expect(fills.length).toBeLessThanOrEqual(28);
    for (const f of fills) {
      expect(f.args[2]).toBeGreaterThanOrEqual(1.5);
      expect(f.args[2]).toBeLessThanOrEqual(3);
      expect(f.args[3]).toBe(f.args[2]);
    }
  });

  it("moves particles up and fades them out by the end of the phase", () => {
    const canvas = fakeCanvas();
    const { frame } = dust(canvas);
    canvas.calls.length = 0;
    frame(1050);
    const early = canvas.of("fillRect").map((f) => ({ y: f.args[1] as number, a: f.alpha }));
    canvas.calls.length = 0;
    frame(1450);
    const late = canvas.of("fillRect").map((f) => ({ y: f.args[1] as number, a: f.alpha }));
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(late.map((p) => p.y))).toBeLessThan(mean(early.map((p) => p.y)));
    expect(mean(late.map((p) => p.a))).toBeLessThan(mean(early.map((p) => p.a)));
    expect(late.every((p) => p.a < 0.25)).toBe(true);
  });

  it("lasts 500ms and then starts the pen with the block opacity back", () => {
    const { h, frame } = dust();
    expect(frame(1499)).toBe(true);
    expect(anims).toHaveLength(1);
    expect(anims[0]?.cancel).not.toHaveBeenCalled();
    h.setNow(1500);
    expect(frame(1500)).toBe(true);
    expect(anims[0]?.cancel).toHaveBeenCalledTimes(1);
    const pen = anims[1];
    expect(pen).toBeDefined();
    // opacity comes back by canceling the hiding animation, not by keyframes
    expect(pen?.keyframes.some((k) => "opacity" in k)).toBe(false);
    expect(pen?.keyframes.every((k) => typeof k.clipPath === "string")).toBe(true);
    expect(pen?.options.fill).toBe("forwards");
  });

  it("draws nothing after the dust phase and never erases by itself", () => {
    const { canvas, frame } = dust();
    frame(1300);
    frame(1500);
    frame(1600);
    expect(canvas.of("clearRect")).toHaveLength(0);
    canvas.calls.length = 0;
    frame(1700);
    expect(canvas.of("fillRect")).toHaveLength(0);
  });

  it("takes randomness only from ctx.random", () => {
    const spy = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Math.random is not allowed");
    });
    const { frame } = dust();
    frame(1100);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("pen phase", () => {
  const WORDS = { old: [r(10, 100, 30, 20)] };

  function run(lineWidth: number) {
    const canvas = fakeCanvas();
    const h = setup({ oldText: "old", newText: "newer text", canvas });
    currentWords = WORDS;
    stubRects(WORDS);
    const lines = [r(10, 100, lineWidth, 20)];
    const { frame } = begin(h, "newer text", lines);
    h.setNow(1500);
    frame(1500);
    return { h, frame, lines, canvas };
  }

  const dot = (h: Harness) => h.layer.firstElementChild as HTMLElement | null;

  it("reveals no longer than 1600ms and ends the effect", () => {
    const { frame } = run(1000);
    expect(anims[1]?.options.duration).toBe(1600);
    expect(frame(1500 + 1599)).toBe(true);
    // one frame past the WAAPI end, so cancel never snaps
    expect(frame(1500 + 1600)).toBe(true);
    expect(frame(1500 + 1600 + 15)).toBe(true);
    expect(frame(1500 + 1600 + 16)).toBe(false);
  });

  it("is faster for a short line", () => {
    run(100);
    const d = anims[1]?.options.duration as number;
    expect(d).toBeLessThan(1600);
    expect(d).toBeGreaterThan(0);
  });

  it("puts a 6px dot in the text color into the layer", () => {
    const { h } = run(200);
    const d = dot(h);
    expect(d).not.toBeNull();
    expect(d?.style.width).toBe("6px");
    expect(d?.style.height).toBe("6px");
    expect(d?.style.borderRadius).toBeTruthy();
    expect(d?.style.background || d?.style.backgroundColor).toBeTruthy();
  });

  it("moves the dot along the line with the frame time", () => {
    const { h, frame } = run(200);
    const dur = anims[1]?.options.duration as number;
    frame(1500 + dur / 2);
    const mid = dot(h)?.style.transform ?? "";
    expect(mid).toContain("translate");
    const x = Number(/translate\(([-\d.]+)px/.exec(mid)?.[1]);
    // line from x=10 width 200, dot 3px radius
    expect(x).toBeCloseTo(10 + 100 - 3, 0);
  });

  it("ends the dot at the right edge of the last line, not at the block edge", () => {
    const { h, frame } = run(200);
    const dur = anims[1]?.options.duration as number;
    frame(1500 + dur - 1);
    const x = Number(/translate\(([-\d.]+)px/.exec(dot(h)?.style.transform ?? "")?.[1]);
    // block is 300 wide, the line ends at 210
    expect(x).toBeGreaterThan(200);
    expect(x).toBeLessThan(215);
  });

  it("finish cancels WAAPI and removes the dot", () => {
    const { h, canvas } = run(200);
    canvas.calls.length = 0;
    penEffect.finish(h.ctx);
    expect(anims.every((a) => a.cancel.mock.calls.length >= 1)).toBe(true);
    expect(h.layer.childElementCount).toBe(0);
    expect(h.node.data).toBe("newer text");
  });
});

describe("finish at any moment", () => {
  it("mid dust: cancels the hiding animation", () => {
    const canvas = fakeCanvas();
    const h = setup({ oldText: "old", newText: "new", canvas });
    currentWords = { old: [r(10, 100, 30, 20)] };
    stubRects(currentWords);
    const { frame } = begin(h, "new", [r(10, 100, 100, 20)]);
    frame(1200);
    canvas.calls.length = 0;
    penEffect.finish(h.ctx);
    expect(anims[0]?.cancel).toHaveBeenCalledTimes(1);
    expect(canvas.calls).toHaveLength(0);
    expect(h.node.data).toBe("new");
  });

  it("is safe to call twice and without a started frame", () => {
    const canvas = fakeCanvas();
    const h = setup({ oldText: "old", newText: "new", canvas });
    penEffect.finish(h.ctx);
    currentWords = { old: [r(10, 100, 30, 20)] };
    stubRects(currentWords);
    begin(h, "new", [r(10, 100, 100, 20)]);
    penEffect.finish(h.ctx);
    penEffect.finish(h.ctx);
    expect(h.layer.childElementCount).toBe(0);
  });
});

describe("bilingual", () => {
  it("skips the dust and reveals the span with the pen at once", () => {
    const canvas = fakeCanvas();
    const h = setup({ oldText: "old", newText: "translated", canvas, bilingual: true });
    currentWords = { old: [r(10, 100, 30, 20)] };
    stubRects(currentWords);
    const { frame } = begin(h, "translated", [r(10, 100, 150, 20)]);
    expect(canvas.calls).toHaveLength(0);
    expect(h.canvasCalls()).toBe(0);
    expect(anims).toHaveLength(1);
    expect(anims[0]?.keyframes.every((k) => typeof k.clipPath === "string")).toBe(true);
    expect(anims[0]?.keyframes.some((k) => "opacity" in k)).toBe(false);
    expect(h.layer.childElementCount).toBe(1);
    const dur = anims[0]?.options.duration as number;
    expect(frame(1000 + dur - 1)).toBe(true);
    expect(frame(1000 + dur)).toBe(true);
    expect(frame(1000 + dur + 16)).toBe(false);
  });
});

describe("two blocks at once", () => {
  function twoBlocks(second: { top: number }) {
    const shared = fakeCanvas();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      (() => shared.ctx) as never,
    );
    document.body.innerHTML = "<p>alpha</p><p>beta</p>";
    const [a, b] = Array.from(document.body.children) as HTMLElement[];
    const place = (el: HTMLElement, top: number) =>
      vi.spyOn(el, "getBoundingClientRect").mockReturnValue(new DOMRect(0, top, 300, 20));
    place(a as HTMLElement, 100);
    place(b as HTMLElement, second.top);
    stubRects({
      alpha: [r(10, 100, 40, 20)],
      beta: [r(10, second.top, 40, 20)],
      one: [r(10, 100, 100, 20)],
      two: [r(10, second.top, 100, 20)],
    });
    let queue: Array<() => void> = [];
    let t = 1000;
    const animator = createAnimator({
      win: window,
      quiet: (fn) => fn(),
      kind: () => "pen",
      raf: (cb) => {
        queue.push(cb);
      },
      now: () => t,
      random: lcg(3),
    });
    animators.push(animator);
    const tokens = [a, b].map((el) => animator.prepare(el as HTMLElement));
    const names = ["one", "two"];
    [a, b].forEach((el, i) => {
      (el?.firstChild as Text).data = names[i] as string;
      animator.play(tokens[i] as NonNullable<(typeof tokens)[number]>, el as HTMLElement);
    });
    const tick = (ms: number) => {
      t += ms;
      shared.calls.length = 0;
      const run = queue;
      queue = [];
      for (const cb of run) cb();
    };
    return { shared, tick, a: a as HTMLElement, b: b as HTMLElement, animator };
  }

  it("clears the canvas once per tick and both adjacent blocks keep their particles", () => {
    // B directly below A: A's dust flies into B's area
    const { shared, tick } = twoBlocks({ top: 120 });
    for (const ms of [50, 100, 100]) {
      tick(ms);
      expect(shared.of("clearRect")).toHaveLength(1);
      const [x, y, w, h] = shared.of("clearRect")[0]?.args ?? [];
      expect([x, y]).toEqual([0, 0]);
      expect(w).toBe(window.innerWidth);
      expect(h).toBe(window.innerHeight);
      // one word each: 6-14 particles per block, all drawn after the clear
      const fills = shared.of("fillRect").length;
      expect(fills).toBeGreaterThanOrEqual(12);
      expect(fills).toBeLessThanOrEqual(28);
      const ops = shared.calls.map((c) => c.op);
      expect(ops.indexOf("clearRect")).toBe(0);
    }
  });

  it("clearRect count does not grow with the word count", () => {
    const shared = fakeCanvas();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      (() => shared.ctx) as never,
    );
    const text = Array.from({ length: 300 }, (_, i) => `w${i}`).join(" ");
    document.body.innerHTML = `<p>${text}</p>`;
    const el = document.body.firstElementChild as HTMLElement;
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 100, 300, 20));
    vi.spyOn(Range.prototype, "getClientRects").mockImplementation(function (this: Range) {
      const s = this.toString();
      return (s.startsWith("w")
        ? [r(10, 100, 20, 20)]
        : [r(10, 100, 100, 20)]) as unknown as DOMRectList;
    });
    const queue: Array<() => void> = [];
    let t = 1000;
    const animator = createAnimator({
      win: window,
      quiet: (fn) => fn(),
      kind: () => "pen",
      raf: (cb) => {
        queue.push(cb);
      },
      now: () => t,
      random: lcg(5),
    });
    animators.push(animator);
    const token = animator.prepare(el);
    (el.firstChild as Text).data = "new";
    animator.play(token as NonNullable<typeof token>, el);
    t += 100;
    shared.calls.length = 0;
    for (const cb of queue.splice(0)) cb();
    expect(shared.of("clearRect")).toHaveLength(1);
    expect(shared.of("fillRect").length).toBeGreaterThanOrEqual(300 * 6);
  });

  it("a finished effect's dust is gone on the next tick", () => {
    const { shared, tick, a } = twoBlocks({ top: 120 });
    tick(50);
    a.remove();
    // A finishes in this tick (block disconnected); its last frame may still be drawn
    tick(50);
    // next tick: one clear, only B's particles
    tick(50);
    expect(shared.of("clearRect")).toHaveLength(1);
    const fills = shared.of("fillRect").length;
    expect(fills).toBeGreaterThanOrEqual(6);
    expect(fills).toBeLessThanOrEqual(14);
  });
});

describe("with the animator", () => {
  it("falls back to fade through the real animator when the canvas is missing", () => {
    document.body.innerHTML = "<p>old text</p>";
    const el = document.body.firstElementChild as HTMLElement;
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      top: 10,
      bottom: 50,
      left: 0,
      right: 100,
      width: 100,
      height: 40,
    } as DOMRect);
    stubRects({ old: [r(0, 10, 20, 20)], text: [r(25, 10, 30, 20)] });
    let queue: Array<() => void> = [];
    let t = 1000;
    const animator = createAnimator({
      win: window,
      quiet: (fn) => fn(),
      kind: () => "pen",
      raf: (cb) => {
        queue.push(cb);
      },
      now: () => t,
      random: lcg(),
    });
    animators.push(animator);
    const token = animator.prepare(el);
    expect(token).not.toBeNull();
    (el.firstChild as Text).data = "new text";
    animator.play(token as NonNullable<typeof token>, el);
    for (let i = 0; i < 40; i++) {
      t += 50;
      const run = queue;
      queue = [];
      for (const cb of run) cb();
    }
    expect(queue).toHaveLength(0);
    expect(el.textContent).toBe("new text");
    expect(document.querySelector("[data-byoglot]")).toBeNull();
  });
});
