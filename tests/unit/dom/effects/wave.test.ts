import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAnimator } from "../../../../lib/dom/effects/animator";
import { revealKeyframes } from "../../../../lib/dom/effects/lines";
import { availableKinds, registry } from "../../../../lib/dom/effects/registry";
import type { EffectContext, Overlay } from "../../../../lib/dom/effects/types";
import { waveEffect } from "../../../../lib/dom/effects/wave";

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

function stubRects(byText: Record<string, DOMRect[]>) {
  vi.spyOn(Range.prototype, "getClientRects").mockImplementation(function (this: Range) {
    return (byText[this.toString()] ?? []) as unknown as DOMRectList;
  });
}

const BLOCK = r(0, 100, 300, 60);

type Harness = {
  ctx: EffectContext;
  block: HTMLElement;
  nodes: Text[];
  layer: HTMLElement;
  released: () => number;
  writes: string[];
  setNow(t: number): void;
  releaseNode(node: Text): void;
};

function setup(opts: {
  from: string[];
  to: string[];
  bilingual?: boolean;
  noOverlay?: boolean;
  blockRect?: DOMRect;
}): Harness {
  const block = document.createElement("p");
  // one text node per entry, split by elements so the nodes stay separate
  for (const [i, text] of opts.from.entries()) {
    if (i > 0) block.append(document.createElement("b"));
    const holder = i === 0 ? block : (block.lastElementChild as Element);
    holder.append(document.createTextNode(text));
  }
  document.body.append(block);
  vi.spyOn(block, "getBoundingClientRect").mockReturnValue(opts.blockRect ?? BLOCK);
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(block, 4);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  // apply has just landed: the page holds `to`
  nodes.forEach((n, i) => {
    n.data = opts.to[i] as string;
  });
  const layer = document.createElement("div");
  document.body.append(layer);
  let t = 1000;
  let released = 0;
  const writes: string[] = [];
  const blocked = new Set<Text>();
  const overlay: Overlay = {
    canvas: () => {
      throw new Error("wave must not use the canvas");
    },
    layer: () => layer,
    beginFrame: () => {},
    release: () => {
      released++;
    },
  };
  const ctx: EffectContext = {
    block,
    changes: nodes.map((node, i) => ({
      node,
      from: opts.from[i] as string,
      to: opts.to[i] as string,
    })),
    bilingual: opts.bilingual ?? false,
    write(n, value) {
      if (blocked.has(n)) return false;
      writes.push(value);
      n.data = value;
      return true;
    },
    overlay: () => (opts.noOverlay ? null : overlay),
    now: () => t,
    random: () => {
      throw new Error("wave needs no randomness");
    },
  };
  return {
    ctx,
    block,
    nodes,
    layer,
    released: () => released,
    writes,
    setNow: (v) => {
      t = v;
    },
    releaseNode: (n) => {
      blocked.add(n);
    },
  };
}

// the band is the only child of the clip box the effect puts into the layer
const clip = (h: Harness) => h.layer.firstElementChild as HTMLElement | null;
const band = (h: Harness) => clip(h)?.firstElementChild as HTMLElement | null;
const bandX = (h: Harness) =>
  Number(/translate\(([-\d.]+)px/.exec(band(h)?.style.transform ?? "")?.[1]);
const bandY = (h: Harness) =>
  Number(/translate\([-\d.]+px,\s*([-\d.]+)px/.exec(band(h)?.style.transform ?? "")?.[1]);

const LINE = [r(10, 100, 200, 20)];

function begin(h: Harness, lines: DOMRect[] = LINE) {
  stubRects(Object.fromEntries(h.ctx.changes.map((c) => [c.to, lines])));
  return waveEffect.start(h.ctx, undefined);
}

describe("registry", () => {
  it("registers wave and marks it as an overlay effect", () => {
    expect(registry.wave).toBe(waveEffect);
    expect(waveEffect.usesOverlay).toBe(true);
    expect(availableKinds()).toContain("wave");
  });
});

describe("fallback to fade", () => {
  it("uses fade when there is no overlay", () => {
    const h = setup({ from: ["old"], to: ["new"], noOverlay: true });
    const frame = begin(h);
    expect(anims).toHaveLength(1);
    expect(anims[0]?.keyframes).toEqual([{ opacity: 1 }, { opacity: 0 }]);
    expect(h.layer.childElementCount).toBe(0);
    expect(frame(1180)).toBe(true);
    waveEffect.finish(h.ctx);
    expect(anims.every((a) => a.cancel.mock.calls.length === 1)).toBe(true);
    expect(h.nodes[0]?.data).toBe("new");
  });
});

describe("shine phase", () => {
  it("restores the old text right at start and puts a band into the layer", () => {
    const h = setup({ from: ["old text"], to: ["new text"] });
    begin(h);
    expect(h.nodes[0]?.data).toBe("old text");
    expect(anims).toHaveLength(0);
    const b = band(h);
    expect(b).not.toBeNull();
    expect(b?.style.width).toBe("90px");
    expect(b?.style.background || b?.style.backgroundImage).toContain("linear-gradient");
    expect(b?.getAttribute("style")).toContain("rgba(255,255,255,.3)");
    expect(b?.getAttribute("style")).not.toContain("mix-blend-mode");
  });

  it("covers the block rect and does not draw on the canvas", () => {
    const h = setup({ from: ["old"], to: ["new"] });
    begin(h);
    const c = clip(h) as HTMLElement;
    expect(c.style.left).toBe("0px");
    expect(c.style.top).toBe("100px");
    expect(c.style.width).toBe("300px");
    expect(c.style.height).toBe("60px");
    expect(c.style.overflow).toBe("hidden");
  });

  it("sweeps left to right with the frame time and lasts 350ms", () => {
    const h = setup({ from: ["old"], to: ["new"] });
    const frame = begin(h);
    const x0 = bandX(h);
    expect(x0).toBeLessThanOrEqual(-90);
    expect(frame(1100)).toBe(true);
    const x1 = bandX(h);
    expect(frame(1250)).toBe(true);
    const x2 = bandX(h);
    expect(x1).toBeGreaterThan(x0);
    expect(x2).toBeGreaterThan(x1);
    expect(frame(1349)).toBe(true);
    expect(bandX(h)).toBeLessThanOrEqual(300);
    expect(h.nodes[0]?.data).toBe("old");
    expect(anims).toHaveLength(0);
  });

  it("covers the whole block height", () => {
    const h = setup({ from: ["old"], to: ["new"] });
    begin(h);
    expect(band(h)?.style.height).toBe("60px");
    expect(bandY(h)).toBe(0);
  });
});

describe("wave phase", () => {
  function toWave(lines: DOMRect[] = LINE) {
    const h = setup({ from: ["old"], to: ["new"] });
    const frame = begin(h, lines);
    h.setNow(1350);
    const alive = frame(1350);
    return { h, frame, alive };
  }

  it("writes `to` at 350ms and reveals with the shared keyframes", () => {
    const { h } = toWave();
    expect(h.nodes[0]?.data).toBe("new");
    expect(anims).toHaveLength(1);
    expect(anims[0]?.keyframes).toEqual(revealKeyframes(BLOCK, LINE));
    expect(anims[0]?.options.fill).toBe("forwards");
    expect(anims[0]?.options.easing).toBe("linear");
  });

  it("is shorter for a short line and not below 400ms", () => {
    toWave([r(10, 100, 100, 20)]);
    const d = anims[0]?.options.duration as number;
    expect(d).toBeLessThan(1200);
    expect(d).toBeGreaterThanOrEqual(400);
  });

  it("takes at least 400ms for a tiny line", () => {
    toWave([r(10, 100, 20, 20)]);
    expect(anims[0]?.options.duration).toBe(400);
  });

  it("never lasts longer than 1200ms, even for a 5000 character block", () => {
    const text = "x".repeat(5000);
    const h = setup({ from: ["old"], to: [text] });
    const lines = Array.from({ length: 60 }, (_, i) => r(10, 100 + i * 20, 280, 20));
    const frame = begin(h, lines);
    h.setNow(1350);
    frame(1350);
    expect(anims[0]?.options.duration).toBe(1200);
    expect(frame(1350 + 1199)).toBe(true);
    expect(frame(1350 + 1200)).toBe(true);
    expect(frame(1350 + 1200 + 16)).toBe(false);
  });

  it("ends one frame after its duration, timed by frame time", () => {
    const { frame } = toWave();
    const d = anims[0]?.options.duration as number;
    expect(frame(1350 + d - 1)).toBe(true);
    expect(frame(1350 + d)).toBe(true);
    expect(frame(1350 + d + 15)).toBe(true);
    expect(frame(1350 + d + 16)).toBe(false);
  });

  it("rides the reveal front: same x as the front on the first line", () => {
    const { h, frame } = toWave();
    const d = anims[0]?.options.duration as number;
    frame(1350 + d / 2);
    // front at x=110, band 90px wide centered on it, clip box starts at x=0
    expect(bandX(h)).toBeCloseTo(110 - 45, 0);
    expect(band(h)?.style.height).toBe("20px");
    expect(bandY(h)).toBe(0);
  });

  it("goes line by line, following the width weighted timeline", () => {
    const lines = [r(10, 100, 100, 20), r(10, 120, 300, 20)];
    const { h, frame } = toWave(lines);
    const d = anims[0]?.options.duration as number;
    frame(1350 + d * 0.1);
    expect(bandY(h)).toBe(0);
    frame(1350 + d * 0.5);
    expect(bandY(h)).toBe(20);
    expect(band(h)?.style.height).toBe("20px");
    // the second line holds 3/4 of the timeline, 0.5 is a third into it
    expect(bandX(h)).toBeCloseTo(10 + 100 - 45, 0);
  });

  it("removes the band after the last frame", () => {
    const { h, frame } = toWave();
    const d = anims[0]?.options.duration as number;
    expect(h.layer.childElementCount).toBe(1);
    expect(frame(1350 + d)).toBe(true);
    expect(h.layer.childElementCount).toBe(1);
    expect(frame(1350 + d + 16)).toBe(false);
    expect(h.layer.childElementCount).toBe(0);
  });

  it("draws nothing and ends at once when the text has no line boxes", () => {
    const { h, alive } = toWave([]);
    expect(alive).toBe(false);
    expect(h.nodes[0]?.data).toBe("new");
    expect(h.layer.childElementCount).toBe(0);
    expect(anims).toHaveLength(0);
  });
});

describe("bilingual", () => {
  it("skips the shine and reveals the span at once", () => {
    const h = setup({ from: [""], to: ["translated"], bilingual: true });
    const frame = begin(h, [r(10, 100, 150, 20)]);
    expect(h.writes).toEqual([]);
    expect(h.nodes[0]?.data).toBe("translated");
    expect(anims).toHaveLength(1);
    expect(anims[0]?.keyframes).toEqual(revealKeyframes(BLOCK, [r(10, 100, 150, 20)]));
    expect(band(h)).not.toBeNull();
    const d = anims[0]?.options.duration as number;
    expect(frame(1000 + d - 1)).toBe(true);
    expect(frame(1000 + d)).toBe(true);
    expect(frame(1000 + d + 16)).toBe(false);
    expect(h.layer.childElementCount).toBe(0);
  });
});

describe("several nodes", () => {
  it("restores and writes every node in document order", () => {
    const h = setup({ from: ["one ", "two", " three"], to: ["uno ", "dos", " tres"] });
    const frame = begin(h);
    expect(h.writes).toEqual(["one ", "two", " three"]);
    expect(h.nodes.map((n) => n.data)).toEqual(["one ", "two", " three"]);
    h.setNow(1350);
    frame(1350);
    expect(h.writes.slice(3)).toEqual(["uno ", "dos", " tres"]);
    expect(h.nodes.map((n) => n.data)).toEqual(["uno ", "dos", " tres"]);
  });
});

describe("node touched by the page", () => {
  it("leaves a released node alone at start and at the wave", () => {
    const h = setup({ from: ["one ", "two"], to: ["uno ", "dos"] });
    h.releaseNode(h.nodes[1] as Text);
    const frame = begin(h);
    expect(h.writes).toEqual(["one "]);
    // the page owns the second node and keeps whatever it put there
    expect(h.nodes[1]?.data).toBe("dos");
    h.setNow(1350);
    frame(1350);
    expect(h.writes).toEqual(["one ", "uno "]);
    waveEffect.finish(h.ctx);
    expect(h.writes).toEqual(["one ", "uno ", "uno "]);
    expect(h.nodes[1]?.data).toBe("dos");
  });

  it("stops writing a node the page touched during the shine", () => {
    const h = setup({ from: ["one"], to: ["uno"] });
    const frame = begin(h);
    h.releaseNode(h.nodes[0] as Text);
    h.setNow(1350);
    frame(1350);
    expect(h.writes).toEqual(["one"]);
  });
});

describe("finish", () => {
  it("mid shine: `to` everywhere, band gone", () => {
    const h = setup({ from: ["one ", "two"], to: ["uno ", "dos"] });
    const frame = begin(h);
    frame(1100);
    waveEffect.finish(h.ctx);
    expect(h.nodes.map((n) => n.data)).toEqual(["uno ", "dos"]);
    expect(h.layer.childElementCount).toBe(0);
  });

  it("mid wave: cancels WAAPI, removes the band, leaves `to`", () => {
    const h = setup({ from: ["old"], to: ["new"] });
    const frame = begin(h);
    h.setNow(1350);
    frame(1350);
    frame(1500);
    expect(h.layer.childElementCount).toBe(1);
    waveEffect.finish(h.ctx);
    expect(anims.every((a) => a.cancel.mock.calls.length === 1)).toBe(true);
    expect(h.layer.childElementCount).toBe(0);
    expect(h.nodes[0]?.data).toBe("new");
  });

  it("right after start and in the bilingual case", () => {
    const h = setup({ from: ["old"], to: ["new"] });
    begin(h);
    waveEffect.finish(h.ctx);
    expect(h.nodes[0]?.data).toBe("new");
    const b = setup({ from: [""], to: ["new"], bilingual: true });
    begin(b);
    waveEffect.finish(b.ctx);
    expect(b.nodes[0]?.data).toBe("new");
    expect(b.layer.childElementCount).toBe(0);
    expect(anims.every((a) => a.cancel.mock.calls.length === 1)).toBe(true);
  });

  it("is safe to call twice and without a started frame", () => {
    const h = setup({ from: ["old"], to: ["new"] });
    waveEffect.finish(h.ctx);
    begin(h);
    waveEffect.finish(h.ctx);
    waveEffect.finish(h.ctx);
    expect(h.layer.childElementCount).toBe(0);
    expect(h.nodes[0]?.data).toBe("new");
  });
});

describe("randomness and canvas", () => {
  it("uses neither ctx.random, Math.random nor the canvas", () => {
    const spy = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Math.random is not allowed");
    });
    const h = setup({ from: ["old"], to: ["new"] });
    const frame = begin(h);
    frame(1100);
    h.setNow(1350);
    frame(1350);
    frame(1500);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("with the animator", () => {
  function lcg(seed = 7) {
    let s = seed;
    return () => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
  }

  function run(bilingual: boolean) {
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
    stubRects({ "new text": [r(0, 10, 90, 20)], "old text": [r(0, 10, 80, 20)] });
    let queue: Array<() => void> = [];
    let t = 1000;
    const animator = createAnimator({
      win: window,
      quiet: (fn) => fn(),
      kind: () => "wave",
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
    const seen: string[] = [];
    animator.play(token as NonNullable<typeof token>, el);
    seen.push(el.textContent ?? "");
    for (let i = 0; i < 60; i++) {
      t += 50;
      const batch = queue;
      queue = [];
      for (const cb of batch) cb();
      seen.push(el.textContent ?? "");
    }
    return { el, queue, seen, bilingual };
  }

  it("shows the old text first, ends on `to` and removes the overlay host", () => {
    const { el, queue, seen } = run(false);
    expect(seen[0]).toBe("old text");
    expect(seen[1]).toBe("old text");
    expect(queue).toHaveLength(0);
    expect(el.textContent).toBe("new text");
    expect(document.querySelector("[data-byoglot]")).toBeNull();
  });
});
