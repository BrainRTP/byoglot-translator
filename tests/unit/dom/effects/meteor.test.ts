import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAnimator } from "../../../../lib/dom/effects/animator";
import { meteorEffect } from "../../../../lib/dom/effects/meteor";
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
  return {
    ctx,
    calls,
    of: (op: string) => calls.filter((c) => c.op === op),
    clear: () => {
      calls.length = 0;
    },
  };
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

afterEach(() => {
  (Element.prototype as { animate?: unknown }).animate = savedAnimate;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function r(left: number, top: number, width: number, height: number): DOMRect {
  return new DOMRect(left, top, width, height);
}

// one rect per character, laid out left to right at the given top
function stubChars(text: string, top: number) {
  vi.spyOn(Range.prototype, "getClientRects").mockImplementation(function (this: Range) {
    const s = this.toString();
    const i = text.indexOf(s);
    return (i < 0 ? [] : [r(10 + i * 10, top, 10 * s.length, 20)]) as unknown as DOMRectList;
  });
}

function lcg(seed = 7) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function setup(opts: {
  oldText: string;
  newText: string;
  canvas?: ReturnType<typeof fakeCanvas> | null;
  noOverlay?: boolean;
  bilingual?: boolean;
}) {
  const block = document.createElement("p");
  block.textContent = opts.oldText;
  document.body.append(block);
  const node = block.firstChild as Text;
  let released = 0;
  const overlay: Overlay = {
    canvas: () => opts.canvas?.ctx ?? null,
    layer: () => document.body,
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
      n.data = value;
      return true;
    },
    overlay: () => (opts.noOverlay ? null : overlay),
    now: () => 1000,
    random: lcg(),
  };
  return { ctx, block, node, released: () => released };
}

// the old text sits in the DOM for before(), then the translation lands
function begin(h: ReturnType<typeof setup>, oldText: string, newText: string) {
  stubChars(oldText, 100);
  const prepared = meteorEffect.before?.(h.block, { bilingual: false });
  h.node.data = newText;
  stubChars(newText, 300);
  return meteorEffect.start(h.ctx, prepared);
}

function oldOf(block: Element) {
  const prepared = meteorEffect.before?.(block, { bilingual: false });
  return (prepared as { old: Array<{ ch: string; font: string }> }).old;
}

describe("registry", () => {
  it("registers meteor as a heavy overlay effect", () => {
    expect(registry.meteor).toBe(meteorEffect);
    expect(meteorEffect.heavy).toBe(true);
    expect(meteorEffect.usesOverlay).toBe(true);
    expect(availableKinds().at(-1)).toBe("meteor");
  });
});

describe("before", () => {
  it("measures every character with its center, font and color", () => {
    document.body.innerHTML = '<p style="color: rgb(1, 2, 3); font-size: 18px">ab</p>';
    stubChars("ab", 100);
    const p = document.body.firstElementChild as Element;
    const old = oldOf(p);
    expect(old).toHaveLength(2);
    expect(old[0]).toMatchObject({ ch: "a", x: 15, y: 110, color: "rgb(1, 2, 3)" });
    expect(String(old[0]?.font)).toContain("18px");
    expect(old[1]).toMatchObject({ ch: "b", x: 25 });
  });

  it("does not measure in bilingual mode", () => {
    const p = document.createElement("p");
    p.textContent = "abc";
    document.body.append(p);
    const spy = vi.spyOn(Range.prototype, "getClientRects");
    const prepared = meteorEffect.before?.(p, { bilingual: true }) as { old: unknown[] };
    expect(prepared.old).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("takes at most 600 characters and switches to words past that", () => {
    const small = "a".repeat(600);
    document.body.innerHTML = `<p>${small}</p>`;
    vi.spyOn(Range.prototype, "getClientRects").mockImplementation(
      () => [r(10, 100, 5, 20)] as unknown as DOMRectList,
    );
    const p = document.body.firstElementChild as Element;
    let old = oldOf(p);
    expect(old).toHaveLength(600);

    const words = Array.from({ length: 300 }, () => "word").join(" ");
    p.textContent = words;
    old = oldOf(p);
    expect(old).toHaveLength(300);
    expect(old[0]?.ch).toBe("word");
  });

  it("skips characters that are not rendered or far below the viewport", () => {
    document.body.innerHTML = "<p>abc</p>";
    vi.spyOn(Range.prototype, "getClientRects").mockImplementation(function (this: Range) {
      const s = this.toString();
      if (s === "a") return [] as unknown as DOMRectList;
      if (s === "b") return [r(10, 100, 10, 20)] as unknown as DOMRectList;
      return [r(10, window.innerHeight + 500, 10, 20)] as unknown as DOMRectList;
    });
    const old = oldOf(document.body.firstElementChild as Element);
    expect(old.map((g) => g.ch)).toEqual(["b"]);
  });
});

describe("fallback to fade", () => {
  it("uses fade without an overlay", () => {
    const h = setup({ oldText: "ab", newText: "xy", noOverlay: true });
    begin(h, "ab", "xy");
    expect(anims[0]?.keyframes).toEqual([{ opacity: 1 }, { opacity: 0 }]);
    meteorEffect.finish(h.ctx);
    expect(h.node.data).toBe("xy");
  });

  it("uses fade when the canvas has no 2d context", () => {
    const h = setup({ oldText: "ab", newText: "xy", canvas: null });
    begin(h, "ab", "xy");
    expect(anims[0]?.keyframes).toEqual([{ opacity: 1 }, { opacity: 0 }]);
    expect(h.released()).toBe(1);
    meteorEffect.finish(h.ctx);
    expect(h.node.data).toBe("xy");
  });
});

describe("fall phase", () => {
  function fall() {
    const canvas = fakeCanvas();
    const h = setup({ oldText: "ab", newText: "xy", canvas });
    const frame = begin(h, "ab", "xy");
    return { h, canvas, frame };
  }

  it("hides the block and draws the old letters at once", () => {
    const { canvas } = fall();
    expect(anims[0]?.keyframes.every((k) => k.opacity === 0)).toBe(true);
    expect(canvas.of("fillText").map((c) => c.args[0] ?? 0).length).toBe(2);
    expect(canvas.of("fillText").every((c) => c.args[0] === 0 && c.args[1] === 0)).toBe(true);
    expect(canvas.of("translate").map((c) => c.args)).toEqual([
      [15, 110],
      [25, 110],
    ]);
  });

  it("pulls the letters down and drops them below the viewport", () => {
    const { canvas, frame } = fall();
    canvas.clear();
    frame(1100);
    const early = canvas.of("translate").map((c) => c.args[1] as number);
    canvas.clear();
    frame(1150);
    const later = canvas.of("translate").map((c) => c.args[1] as number);
    expect(early.length).toBe(2);
    expect(Math.max(...later)).toBeGreaterThan(Math.max(...early));
    let n = 1150;
    while (n < 2250) {
      n += 50;
      canvas.clear();
      frame(n);
    }
    expect(canvas.of("translate")).toHaveLength(0);
  });

  it("survives a long pause without exploding", () => {
    const { canvas, frame } = fall();
    canvas.clear();
    frame(6000);
    expect(canvas.of("translate")).toHaveLength(0);
    expect(frame(6000)).toBe(true);
  });

  it("takes randomness only from ctx.random", () => {
    const spy = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Math.random is not allowed");
    });
    const { frame } = fall();
    frame(1100);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("rain phase", () => {
  function rain() {
    const canvas = fakeCanvas();
    const h = setup({ oldText: "ab", newText: "xy", canvas });
    const frame = begin(h, "ab", "xy");
    return { h, canvas, frame };
  }

  const heads = (c: ReturnType<typeof fakeCanvas>) =>
    c.of("fillText").filter((x) => x.args[0] !== 0 || x.args[1] !== 0);

  it("starts 300ms before the fall ends", () => {
    const { canvas, frame } = rain();
    canvas.clear();
    frame(1000 + 890);
    expect(heads(canvas)).toHaveLength(0);
    canvas.clear();
    frame(1000 + 950);
    expect(heads(canvas).length).toBeGreaterThan(0);
  });

  it("draws an 8 point tail behind a meteor in flight", () => {
    const { canvas, frame } = rain();
    canvas.clear();
    frame(1000 + 900 + 500);
    expect(canvas.of("fillRect").length).toBeGreaterThanOrEqual(8);
    const alphas = canvas
      .of("fillRect")
      .slice(0, 8)
      .map((c) => c.alpha);
    for (let i = 1; i < alphas.length; i++) expect(alphas[i]).toBeLessThan(alphas[i - 1] as number);
  });

  it("leaves the letters on their targets and drops the canvas after the reveal", () => {
    const { h, canvas, frame } = rain();
    const rainEnd = 1000 + 900 + 1300;
    canvas.clear();
    frame(rainEnd - 1);
    const landed = canvas.of("fillText").filter((c) => c.args[0] === 15 && c.args[1] === 310);
    expect(landed.length).toBeGreaterThan(0);
    expect(anims[0]?.cancel).not.toHaveBeenCalled();

    canvas.clear();
    expect(frame(rainEnd)).toBe(true);
    expect(anims[0]?.cancel).toHaveBeenCalledTimes(1);
    expect(anims[1]?.keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(anims[1]?.options.duration).toBe(150);
    expect(canvas.of("fillText").every((c) => c.alpha <= 1)).toBe(true);

    canvas.clear();
    frame(rainEnd + 150);
    expect(canvas.of("fillText").every((c) => c.alpha === 0)).toBe(true);
    expect(frame(rainEnd + 150 + 15)).toBe(true);
    expect(frame(rainEnd + 150 + 16)).toBe(false);
    meteorEffect.finish(h.ctx);
    expect(anims.every((a) => a.cancel.mock.calls.length >= 1)).toBe(true);
    expect(h.node.data).toBe("xy");
  });

  it("starts the rain at once when the old text is not measured (bilingual)", () => {
    const canvas = fakeCanvas();
    const h = setup({ oldText: "xy", newText: "xy", canvas, bilingual: true });
    stubChars("xy", 300);
    const frame = meteorEffect.start(h.ctx, meteorEffect.before?.(h.block, { bilingual: true }));
    canvas.clear();
    frame(1100);
    expect(heads(canvas).length).toBeGreaterThan(0);
    expect(frame(1000 + 1300)).toBe(true);
    expect(frame(1000 + 1300 + 16 + 150)).toBe(false);
  });
});

describe("finish", () => {
  it("in the middle of the fall cancels the animations and keeps the new text", () => {
    const canvas = fakeCanvas();
    const h = setup({ oldText: "ab", newText: "xy", canvas });
    const frame = begin(h, "ab", "xy");
    frame(1200);
    meteorEffect.finish(h.ctx);
    expect(anims.every((a) => a.cancel.mock.calls.length === 1)).toBe(true);
    expect(h.node.data).toBe("xy");
  });
});

describe("with the animator", () => {
  function make() {
    return createAnimator({
      win: window,
      quiet: (fn) => fn(),
      kind: () => "meteor",
      raf: () => {},
      now: () => 0,
      random: lcg(),
    });
  }

  it("animates six blocks and changes the seventh at once", () => {
    const animator = make();
    const tokens = [];
    for (let i = 0; i < 7; i++) {
      const p = document.createElement("p");
      p.textContent = `old ${i}`;
      document.body.append(p);
      vi.spyOn(p, "getBoundingClientRect").mockReturnValue(r(0, 10, 100, 20));
      const token = animator.prepare(p);
      tokens.push(token);
      if (token) {
        (p.firstChild as Text).data = `new ${i}`;
        animator.play(token, p);
      }
    }
    expect(tokens.filter(Boolean)).toHaveLength(6);
    expect(tokens[6]).toBeNull();
    animator.finishAll();
  });

  it("lets a scroll that moved the block finish the effect with the final text", () => {
    const animator = make();
    const p = document.createElement("p");
    p.textContent = "old";
    document.body.append(p);
    const rect = vi.spyOn(p, "getBoundingClientRect").mockReturnValue(r(0, 10, 100, 20));
    const token = animator.prepare(p);
    (p.firstChild as Text).data = "new";
    if (token) animator.play(token, p);
    rect.mockReturnValue(r(0, 400, 100, 20));
    window.dispatchEvent(new Event("scroll"));
    expect(p.textContent).toBe("new");
    expect(anims.every((a) => a.cancel.mock.calls.length >= 1)).toBe(true);
  });
});
