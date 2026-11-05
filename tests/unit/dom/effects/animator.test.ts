import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MARK_ATTR } from "../../../../lib/dom/constants";
import {
  createAnimator,
  MAX_ACTIVE,
  MAX_ACTIVE_HEAVY,
  type Token,
} from "../../../../lib/dom/effects/animator";
import type { Overlay } from "../../../../lib/dom/effects/overlay";
import { availableKinds, registry } from "../../../../lib/dom/effects/registry";
import type {
  AnimationKind,
  Effect,
  EffectContext,
  TextChange,
} from "../../../../lib/dom/effects/types";

type Probe = {
  effect: Effect;
  contexts: EffectContext[];
  finished: number;
  writes: boolean[];
};

function makeProbe(heavy = false): Probe {
  const probe: Probe = {
    contexts: [],
    finished: 0,
    writes: [],
    effect: {
      kind: "fade",
      heavy,
      start(ctx) {
        probe.contexts.push(ctx);
        for (const c of ctx.changes) probe.writes.push(ctx.write(c.node, c.from));
        let n = 0;
        return () => {
          n++;
          if (n < 3) return true;
          for (const c of ctx.changes) probe.writes.push(ctx.write(c.node, c.to));
          return false;
        };
      },
      finish(ctx) {
        probe.finished++;
        for (const c of ctx.changes) ctx.write(c.node, c.to);
      },
    },
  };
  return probe;
}

function rect(top: number, bottom: number): DOMRect {
  return {
    top,
    bottom,
    left: 0,
    right: 100,
    width: 100,
    height: bottom - top,
    x: 0,
    y: top,
  } as DOMRect;
}

function makeBlock(html: string, top = 10, bottom = 50): HTMLElement {
  document.body.innerHTML = html;
  const el = document.body.firstElementChild as HTMLElement;
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue(rect(top, bottom));
  return el;
}

function harness(kind: AnimationKind = "fade") {
  let queue: Array<() => void> = [];
  let t = 0;
  const quiet = vi.fn((fn: () => void) => fn());
  const animator = createAnimator({
    win: window,
    quiet,
    kind: () => kind,
    raf: (cb) => {
      queue.push(cb);
    },
    now: () => (t += 16),
    random: () => 0.5,
  });
  const tick = () => {
    const run = queue;
    queue = [];
    for (const cb of run) cb();
  };
  return { animator, quiet, tick, pending: () => queue.length };
}

function texts(el: Element): Text[] {
  const out: Text[] = [];
  const w = document.createTreeWalker(el, 4);
  for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n as Text);
  return out;
}

function textAt(el: Element, i: number): Text {
  const node = texts(el)[i];
  if (!node) throw new Error(`no text node ${i}`);
  return node;
}

function firstCtx(): EffectContext {
  const ctx = probe.contexts[0];
  if (!ctx) throw new Error("effect not started");
  return ctx;
}

let saved: Effect | undefined;
let probe: Probe;

beforeEach(() => {
  saved = registry.fade;
  probe = makeProbe();
  registry.fade = probe.effect;
});

afterEach(() => {
  registry.fade = saved;
  vi.restoreAllMocks();
});

describe("registry", () => {
  it("lists registered kinds in fixed order", () => {
    expect(availableKinds()).toEqual([
      "none",
      "fade",
      "scramble",
      "flap",
      "typewriter",
      "pen",
      "wave",
      "meteor",
    ]);
    const meteor = registry.meteor;
    delete registry.meteor;
    try {
      expect(availableKinds()).not.toContain("meteor");
    } finally {
      registry.meteor = meteor;
    }
  });
});

describe("prepare", () => {
  it("returns null for none", () => {
    const h = harness("none");
    expect(h.animator.prepare(makeBlock("<p>Hello</p>"))).toBeNull();
  });

  it("returns null for a kind missing in the registry", () => {
    const meteor = registry.meteor;
    delete registry.meteor;
    try {
      const h = harness("meteor");
      expect(h.animator.prepare(makeBlock("<p>Hello</p>"))).toBeNull();
    } finally {
      registry.meteor = meteor;
    }
  });

  it("returns null under reduced motion", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    const h = harness();
    expect(h.animator.prepare(makeBlock("<p>Hello</p>"))).toBeNull();
  });

  it("works without matchMedia", () => {
    const original = Object.getOwnPropertyDescriptor(window, "matchMedia");
    Object.defineProperty(window, "matchMedia", { value: undefined, configurable: true });
    try {
      const h = harness();
      expect(h.animator.prepare(makeBlock("<p>Hello</p>"))).not.toBeNull();
    } finally {
      if (original) Object.defineProperty(window, "matchMedia", original);
      else Reflect.deleteProperty(window, "matchMedia");
    }
  });

  it("returns null while the tab is hidden", () => {
    const h = harness();
    const state = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    expect(h.animator.prepare(makeBlock("<p>Hello</p>"))).toBeNull();
    state.mockReturnValue("visible");
    expect(h.animator.prepare(makeBlock("<p>Hello</p>"))).not.toBeNull();
  });

  it("passes the display mode to before()", () => {
    const seen: unknown[] = [];
    registry.fade = { ...probe.effect, before: (_b, o) => void seen.push(o) };
    const h = harness();
    h.animator.prepare(makeBlock("<p>Hello</p>"));
    h.animator.prepare(makeBlock("<p>Hello</p>"), { bilingual: true });
    expect(seen).toEqual([{ bilingual: false }, { bilingual: true }]);
  });

  it("trusts a precomputed visibility instead of reading the rect", () => {
    const h = harness();
    const el = makeBlock("<p>Hello</p>", -200, -10);
    const spy = vi.spyOn(el, "getBoundingClientRect");
    expect(h.animator.prepare(el, { visible: true })).not.toBeNull();
    expect(h.animator.prepare(makeBlock("<p>Hello</p>"), { visible: false })).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("inView lists the visible blocks and reads nothing when animation is off", () => {
    const h = harness();
    const on = makeBlock("<p>a</p>");
    const off = makeBlock("<p>b</p>", -200, -10);
    expect([...h.animator.inView([on, off])]).toEqual([on]);
    const none = harness("none");
    const spy = vi.spyOn(on, "getBoundingClientRect");
    spy.mockClear();
    expect(none.animator.inView([on]).size).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns null for blocks outside the viewport", () => {
    const h = harness();
    expect(h.animator.prepare(makeBlock("<p>Hello</p>", -200, -10))).toBeNull();
    expect(
      h.animator.prepare(
        makeBlock("<p>Hello</p>", window.innerHeight + 5, window.innerHeight + 50),
      ),
    ).toBeNull();
    expect(h.animator.prepare(makeBlock("<p>Hello</p>", -20, 20))).not.toBeNull();
  });

  it("returns null over the active limit", () => {
    const h = harness();
    for (let i = 0; i < MAX_ACTIVE; i++) {
      const el = makeBlock("<p>old</p>");
      const token = h.animator.prepare(el) as Token;
      expect(token).not.toBeNull();
      textAt(el, 0).data = "new";
      h.animator.play(token, el);
    }
    expect(h.animator.prepare(makeBlock("<p>old</p>"))).toBeNull();
  });

  it("limits heavy effects separately", () => {
    registry.fade = makeProbe(true).effect;
    const h = harness();
    for (let i = 0; i < MAX_ACTIVE_HEAVY; i++) {
      const el = makeBlock("<p>old</p>");
      const token = h.animator.prepare(el) as Token;
      expect(token).not.toBeNull();
      textAt(el, 0).data = "new";
      h.animator.play(token, el);
    }
    expect(h.animator.prepare(makeBlock("<p>old</p>"))).toBeNull();
  });
});

describe("play: changes", () => {
  it("collects changed and new nodes in replace, skips blank and unchanged", () => {
    const el = makeBlock("<p>Hello <b>world</b> <i>same</i></p>");
    const h = harness();
    const token = h.animator.prepare(el) as Token;
    const hello = textAt(el, 0);
    const world = textAt(el, 1);
    hello.data = "Privet ";
    world.data = "mir";
    el.append(document.createTextNode("  "), document.createTextNode("tail"));
    h.animator.play(token, el);
    const changes = firstCtx().changes;
    expect(changes.map((c: TextChange) => [c.from, c.to])).toEqual([
      ["Hello ", "Privet "],
      ["world", "mir"],
      ["", "tail"],
    ]);
    expect(firstCtx().bilingual).toBe(false);
  });

  it("uses from = empty for every node of the inserted span in bilingual", () => {
    const el = makeBlock("<p>Hello</p>");
    const h = harness();
    const token = h.animator.prepare(el) as Token;
    const span = document.createElement("span");
    span.innerHTML = "Privet <b>mir</b>";
    el.append(span);
    h.animator.play(token, span);
    const ctx = firstCtx();
    expect(ctx.changes.map((c: TextChange) => [c.from, c.to])).toEqual([
      ["", "Privet "],
      ["", "mir"],
    ]);
    expect(ctx.bilingual).toBe(true);
    expect(ctx.block).toBe(span);
    expect(ctx.overlay()).toBeNull();
  });

  it("does nothing when nothing changed", () => {
    const el = makeBlock("<p>Hello</p>");
    const h = harness();
    const token = h.animator.prepare(el) as Token;
    h.animator.play(token, el);
    expect(probe.contexts).toHaveLength(0);
    expect(h.pending()).toBe(0);
  });
});

describe("frames", () => {
  function setup(html = "<p>old text</p>") {
    const el = makeBlock(html);
    const h = harness();
    const token = h.animator.prepare(el) as Token;
    const node = textAt(el, 0);
    node.data = "new text";
    return { el, h, token, node };
  }

  it("runs the first write synchronously inside play", () => {
    const { el, h, token, node } = setup();
    h.animator.play(token, el);
    expect(node.data).toBe("old text");
  });

  it("reaches the final text after the effect frames and calls finish", () => {
    const { el, h, token, node } = setup();
    h.animator.play(token, el);
    h.tick();
    h.tick();
    expect(node.data).toBe("old text");
    h.tick();
    expect(node.data).toBe("new text");
    expect(probe.finished).toBe(1);
    expect(h.pending()).toBe(0);
  });

  it("runs all active effects in one quiet call per tick", () => {
    const a = setup();
    const b = makeBlock("<p>old</p>");
    const tokenB = a.h.animator.prepare(b) as Token;
    textAt(b, 0).data = "new";
    a.h.animator.play(a.token, a.el);
    a.h.animator.play(tokenB, b);
    expect(a.h.quiet).not.toHaveBeenCalled();
    a.h.tick();
    expect(a.h.quiet).toHaveBeenCalledTimes(1);
  });

  it("leaves a node alone after a foreign edit", () => {
    const { el, h, token, node } = setup();
    h.animator.play(token, el);
    node.data = "page edit";
    h.tick();
    h.tick();
    h.tick();
    expect(node.data).toBe("page edit");
    expect(probe.writes.slice(1).every((w) => w === false)).toBe(true);
    expect(probe.finished).toBe(1);
  });

  it("finishAll sets every node to its final text and stops the loop", () => {
    const { el, h, token, node } = setup("<p>old <b>bold</b></p>");
    const other = textAt(el, 1);
    other.data = "zhir";
    h.animator.play(token, el);
    expect(node.data).toBe("old ");
    h.animator.finishAll();
    expect(node.data).toBe("new text");
    expect(other.data).toBe("zhir");
    expect(probe.finished).toBe(1);
    h.tick();
    expect(probe.finished).toBe(1);
    expect(h.pending()).toBe(0);
    h.animator.finishAll();
    expect(probe.finished).toBe(1);
  });

  it("busy is true from play until the effect ends", () => {
    const { el, h, token } = setup();
    expect(h.animator.busy()).toBe(false);
    h.animator.play(token, el);
    expect(h.animator.busy()).toBe(true);
    h.tick();
    h.tick();
    h.tick();
    expect(h.animator.busy()).toBe(false);
  });

  it("busy is false after finishAll", () => {
    const { el, h, token } = setup();
    h.animator.play(token, el);
    h.animator.finishAll();
    expect(h.animator.busy()).toBe(false);
  });

  it("survives the block being removed mid-animation", () => {
    const { el, h, token, node } = setup();
    h.animator.play(token, el);
    el.remove();
    expect(() => h.tick()).not.toThrow();
    expect(probe.finished).toBe(1);
    expect(node.data).toBe("new text");
    expect(h.pending()).toBe(0);
  });

  it("keeps a page edit made before the first write of a late-writing effect", () => {
    const results: boolean[] = [];
    registry.fade = {
      kind: "fade",
      start(ctx) {
        let n = 0;
        return () => {
          n++;
          if (n < 3) return true;
          for (const c of ctx.changes) results.push(ctx.write(c.node, "frame"));
          return false;
        };
      },
      finish(ctx) {
        for (const c of ctx.changes) ctx.write(c.node, c.to);
      },
    };
    const { el, h, token, node } = setup();
    h.animator.play(token, el);
    h.tick();
    node.data = "page edit";
    h.tick();
    h.tick();
    expect(results).toEqual([false]);
    expect(node.data).toBe("page edit");
  });

  it("frees the active slots after an effect finishes", () => {
    const fill = (n: number) => {
      const h = harness();
      const els: HTMLElement[] = [];
      for (let i = 0; i < n; i++) {
        const el = makeBlock("<p>old</p>");
        const token = h.animator.prepare(el) as Token;
        textAt(el, 0).data = "new";
        h.animator.play(token, el);
        els.push(el);
      }
      return { h, els };
    };
    for (const [heavy, limit] of [
      [false, MAX_ACTIVE],
      [true, MAX_ACTIVE_HEAVY],
    ] as const) {
      registry.fade = makeProbe(heavy).effect;
      const { h, els } = fill(limit);
      expect(h.animator.prepare(makeBlock("<p>old</p>"))).toBeNull();
      els[0]?.remove();
      h.tick();
      expect(h.animator.prepare(makeBlock("<p>old</p>"))).not.toBeNull();
    }
  });

  it("finishes with the final text when a frame throws", () => {
    registry.fade = {
      kind: "fade",
      start(ctx) {
        for (const c of ctx.changes) ctx.write(c.node, c.from);
        return () => {
          throw new Error("boom");
        };
      },
      finish() {
        // forgets to restore: the animator settles owned nodes
      },
    };
    const { el, h, token, node } = setup();
    h.animator.play(token, el);
    expect(() => h.tick()).not.toThrow();
    expect(node.data).toBe("new text");
  });

  it("settles when start throws", () => {
    registry.fade = {
      kind: "fade",
      start(ctx) {
        for (const c of ctx.changes) ctx.write(c.node, c.from);
        throw new Error("boom");
      },
      finish() {},
    };
    const { el, h, token, node } = setup();
    expect(() => h.animator.play(token, el)).not.toThrow();
    expect(node.data).toBe("new text");
    expect(h.pending()).toBe(0);
  });

  it("passes prepared data from before() to start()", () => {
    const seen: unknown[] = [];
    registry.fade = {
      ...probe.effect,
      before: () => "snapshot",
      start(ctx, prepared) {
        seen.push(prepared);
        return probe.effect.start(ctx, prepared);
      },
    };
    const { el, h, token } = setup();
    h.animator.play(token, el);
    expect(seen).toEqual(["snapshot"]);
  });
});

describe("overlay", () => {
  type Seen = { overlay: Overlay | null; finished: number };

  function forever(kind: AnimationKind, usesOverlay: boolean, seen: Seen): Effect {
    return {
      kind,
      usesOverlay,
      start(ctx) {
        seen.overlay = ctx.overlay();
        for (const c of ctx.changes) ctx.write(c.node, c.from);
        return () => !ctx.block.hasAttribute("data-stop");
      },
      finish(ctx) {
        seen.finished++;
        for (const c of ctx.changes) ctx.write(c.node, c.to);
      },
    };
  }

  const hosts = () => document.querySelectorAll(`[${MARK_ATTR}]`).length;
  let savedPen: Effect | undefined;

  function setup(html: string, kind: AnimationKind, shared?: ReturnType<typeof harness>) {
    const el = document.createElement("div");
    el.innerHTML = html;
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue(rect(10, 50));
    document.body.append(el);
    const h = shared ?? harness(kind);
    const token = h.animator.prepare(el) as Token;
    const node = textAt(el, 0);
    node.data = "new text";
    h.animator.play(token, el);
    return { h, node, el };
  }

  beforeEach(() => {
    document.body.innerHTML = "";
    savedPen = registry.pen;
  });

  afterEach(() => {
    registry.pen = savedPen;
  });

  it("gives an overlay only to effects marked usesOverlay", () => {
    const plain: Seen = { overlay: null, finished: 0 };
    registry.fade = forever("fade", false, plain);
    setup("<p>old text</p>", "fade");
    expect(plain.overlay).toBeNull();
    expect(hosts()).toBe(0);

    const pen: Seen = { overlay: null, finished: 0 };
    registry.pen = forever("pen", true, pen);
    const { h } = setup("<p>old text</p>", "pen");
    expect(pen.overlay).not.toBeNull();
    expect(hosts()).toBe(1);
    h.animator.finishAll();
    expect(hosts()).toBe(0);
  });

  it("returns the same overlay on repeated calls within one effect", () => {
    const seen: Seen = { overlay: null, finished: 0 };
    const pen = forever("pen", true, seen);
    registry.pen = {
      ...pen,
      start(ctx, p) {
        const frame = pen.start(ctx, p);
        expect(ctx.overlay()).toBe(seen.overlay);
        return frame;
      },
    };
    const { h } = setup("<p>old text</p>", "pen");
    h.animator.finishAll();
  });

  it("window scroll that moves the block finishes overlay effects only, leaves the text final and removes the overlay", () => {
    const pen: Seen = { overlay: null, finished: 0 };
    const plain: Seen = { overlay: null, finished: 0 };
    registry.pen = forever("pen", true, pen);
    registry.fade = forever("fade", false, plain);
    const a = setup("<p>old a</p>", "pen");
    const b = setup("<p>old b</p>", "fade");
    expect(a.node.data).toBe("old a");
    vi.spyOn(a.el, "getBoundingClientRect").mockReturnValue(rect(40, 80));
    vi.spyOn(b.el, "getBoundingClientRect").mockReturnValue(rect(40, 80));
    window.dispatchEvent(new Event("scroll"));
    expect(pen.finished).toBe(1);
    expect(a.node.data).toBe("new text");
    expect(hosts()).toBe(0);
    expect(plain.finished).toBe(0);
    expect(b.node.data).toBe("old b");
    b.h.tick();
    expect(plain.finished).toBe(0);
    expect(b.node.data).toBe("old b");
    b.h.animator.finishAll();
  });

  it("keeps running when an inner element scrolls and the block did not move", () => {
    const pen: Seen = { overlay: null, finished: 0 };
    registry.pen = forever("pen", true, pen);
    const a = setup("<p>old a</p>", "pen");
    a.node.parentElement?.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("scroll"));
    expect(pen.finished).toBe(0);
    expect(a.node.data).toBe("old a");
    expect(hosts()).toBe(1);
    a.h.animator.finishAll();
  });

  it("tolerates a sub-pixel shift but not a bigger one", () => {
    const pen: Seen = { overlay: null, finished: 0 };
    registry.pen = forever("pen", true, pen);
    const a = setup("<p>old a</p>", "pen");
    const at = (top: number, left: number) =>
      vi.spyOn(a.el, "getBoundingClientRect").mockReturnValue({
        ...rect(top, top + 40),
        left,
        right: left + 100,
      } as DOMRect);
    at(10.5, 0.5);
    window.dispatchEvent(new Event("scroll"));
    expect(pen.finished).toBe(0);
    at(10, 2);
    window.dispatchEvent(new Event("scroll"));
    expect(pen.finished).toBe(1);
  });

  it("finishes moved blocks only", () => {
    const pen: Seen = { overlay: null, finished: 0 };
    registry.pen = forever("pen", true, pen);
    const a = setup("<p>old a</p>", "pen");
    const b = setup("<p>old b</p>", "pen", a.h);
    vi.spyOn(b.el, "getBoundingClientRect").mockReturnValue(rect(100, 140));
    window.dispatchEvent(new Event("scroll"));
    expect(pen.finished).toBe(1);
    expect(a.node.data).toBe("old a");
    expect(b.node.data).toBe("new text");
    a.h.animator.finishAll();
  });

  it("window resize that changes the block size finishes overlay effects", () => {
    const pen: Seen = { overlay: null, finished: 0 };
    registry.pen = forever("pen", true, pen);
    const a = setup("<p>old a</p>", "pen");
    window.dispatchEvent(new Event("resize"));
    expect(pen.finished).toBe(0);
    vi.spyOn(a.el, "getBoundingClientRect").mockReturnValue({
      ...rect(10, 50),
      width: 60,
      right: 60,
    } as DOMRect);
    window.dispatchEvent(new Event("resize"));
    expect(pen.finished).toBe(1);
    expect(a.node.data).toBe("new text");
    expect(hosts()).toBe(0);
  });

  it("reads all rects before finishing any entry", () => {
    const order: string[] = [];
    const pen: Seen = { overlay: null, finished: 0 };
    registry.pen = {
      ...forever("pen", true, pen),
      finish(ctx) {
        order.push("finish");
        for (const c of ctx.changes) ctx.write(c.node, c.to);
      },
    };
    const a = setup("<p>old a</p>", "pen");
    const b = setup("<p>old b</p>", "pen", a.h);
    for (const x of [a, b]) {
      vi.spyOn(x.el, "getBoundingClientRect").mockImplementation(() => {
        order.push("read");
        return rect(200, 240);
      });
    }
    window.dispatchEvent(new Event("scroll"));
    expect(order).toEqual(["read", "read", "finish", "finish"]);
  });

  it("finishWithin finishes the block itself and blocks inside or around it, others keep running", () => {
    const seen: Seen = { overlay: null, finished: 0 };
    registry.pen = forever("pen", true, seen);
    const a = setup("<p>old a</p>", "pen");
    const b = setup("<p>old b</p>", "pen", a.h);
    const outer = document.createElement("section");
    document.body.append(outer);
    outer.append(b.el);
    a.h.animator.finishWithin(a.el);
    expect(seen.finished).toBe(1);
    expect(a.node.data).toBe("new text");
    expect(b.node.data).toBe("old b");
    a.h.animator.finishWithin(outer);
    expect(seen.finished).toBe(2);
    expect(b.node.data).toBe("new text");
    a.h.animator.finishWithin(document.body);
    expect(seen.finished).toBe(2);
  });

  it("finishWithin also hits a block that contains the element", () => {
    const seen: Seen = { overlay: null, finished: 0 };
    registry.pen = forever("pen", true, seen);
    const a = setup("<p>old a</p>", "pen");
    a.h.animator.finishWithin(a.node.parentElement as Element);
    expect(seen.finished).toBe(1);
  });

  it("runs scroll finish inside quiet", () => {
    const pen: Seen = { overlay: null, finished: 0 };
    registry.pen = forever("pen", true, pen);
    const a = setup("<p>old a</p>", "pen");
    const before = a.h.quiet.mock.calls.length;
    vi.spyOn(a.el, "getBoundingClientRect").mockReturnValue(rect(200, 240));
    window.dispatchEvent(new Event("scroll"));
    expect(a.h.quiet.mock.calls.length).toBeGreaterThan(before);
  });

  it("subscribes lazily and unsubscribes when no overlay effect remains", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const names = (spy: typeof add) => spy.mock.calls.map((c) => c[0]).sort();

    const plain: Seen = { overlay: null, finished: 0 };
    registry.fade = forever("fade", false, plain);
    const p = setup("<p>old a</p>", "fade");
    expect(names(add)).toEqual([]);
    p.h.animator.finishAll();

    const pen: Seen = { overlay: null, finished: 0 };
    registry.pen = forever("pen", true, pen);
    const a = setup("<p>old a</p>", "pen");
    expect(names(add)).toEqual(["resize", "scroll"]);
    const scrollOpts = add.mock.calls.find((c) => c[0] === "scroll")?.[2];
    expect(scrollOpts).toMatchObject({ capture: true, passive: true });
    const b = setup("<p>old b</p>", "pen", a.h);
    expect(names(add)).toEqual(["resize", "scroll"]);
    a.el.setAttribute("data-stop", "");
    a.h.tick();
    expect(pen.finished).toBe(1);
    expect(names(remove)).toEqual([]);
    b.el.setAttribute("data-stop", "");
    a.h.tick();
    expect(pen.finished).toBe(2);
    expect(names(remove)).toEqual(["resize", "scroll"]);
  });

  it("wipes the shared canvas once per tick, before the frames", () => {
    const order: string[] = [];
    const handles: Overlay[] = [];
    registry.pen = {
      kind: "pen",
      usesOverlay: true,
      start(ctx) {
        const o = ctx.overlay();
        if (o) {
          handles.push(o);
          vi.spyOn(o, "beginFrame").mockImplementation(() => {
            order.push("begin");
          });
        }
        return () => {
          order.push("frame");
          return true;
        };
      },
      finish() {},
    };
    const a = setup("<p>old a</p>", "pen");
    setup("<p>old b</p>", "pen", a.h);
    expect(handles).toHaveLength(2);
    a.h.tick();
    expect(order).toEqual(["begin", "frame", "frame"]);
    a.h.tick();
    expect(order).toEqual(["begin", "frame", "frame", "begin", "frame", "frame"]);
    a.h.animator.finishAll();
  });

  it("does not touch the canvas for effects without an overlay", () => {
    const plain: Seen = { overlay: null, finished: 0 };
    registry.fade = forever("fade", false, plain);
    const spy = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
    const { h } = setup("<p>old a</p>", "fade");
    h.tick();
    expect(spy).not.toHaveBeenCalled();
    h.animator.finishAll();
  });

  it("releases the overlay when the effect forgets to", () => {
    const seen: Seen = { overlay: null, finished: 0 };
    registry.pen = forever("pen", true, seen);
    const { h } = setup("<p>old a</p>", "pen");
    expect(hosts()).toBe(1);
    h.animator.finishAll();
    expect(hosts()).toBe(0);
  });

  it("lets the effect release early and acquire again", () => {
    const seen: Seen = { overlay: null, finished: 0 };
    registry.pen = {
      ...forever("pen", true, seen),
      start(ctx) {
        ctx.overlay()?.release();
        seen.overlay = ctx.overlay();
        for (const c of ctx.changes) ctx.write(c.node, c.from);
        return () => true;
      },
    };
    const { h } = setup("<p>old a</p>", "pen");
    expect(seen.overlay).not.toBeNull();
    expect(hosts()).toBe(1);
    h.animator.finishAll();
    expect(hosts()).toBe(0);
  });
});
