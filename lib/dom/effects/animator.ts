import { acquireOverlay, type Overlay } from "./overlay";
import { registry } from "./registry";
import type { AnimationKind, Effect, EffectContext, Frame, Prepared, TextChange } from "./types";
import { textNodes } from "./util";

export const MAX_ACTIVE = 24;
export const MAX_ACTIVE_HEAVY = 6;

const BLANK = /^\s*$/;

export type Token = {
  readonly block: Element;
  readonly effect: Effect;
  readonly prepared: Prepared;
  readonly from: Map<Text, string>;
};

export type PrepareOptions = {
  bilingual?: boolean;
  // precomputed by inView() for a whole batch, read from the layout otherwise
  visible?: boolean;
};

export type Animator = {
  prepare(block: Element, opts?: PrepareOptions): Token | null;
  // the elements of a batch that are on screen, read in one pass before any DOM write
  inView(blocks: readonly Element[]): Set<Element>;
  play(token: Token, appliedRoot: Element): void;
  finishAll(): void;
  finishWithin(el: Element): void;
  // true while at least one effect is still running
  busy(): boolean;
};

export type AnimatorOptions = {
  win: Window;
  quiet(fn: () => void): void;
  kind(): AnimationKind;
  raf?: (cb: () => void) => unknown;
  now?: () => number;
  random?: () => number;
};

type Entry = {
  effect: Effect;
  ctx: EffectContext;
  frame: Frame | null;
  changes: TextChange[];
  lastWritten: WeakMap<Text, string>;
  overlay(): Overlay | null;
  releaseOverlay(): void;
  // block rect when the effect started, overlay coordinates are frozen to it
  startRect: DOMRect | null;
  done: boolean;
};

// px: a shift or a size change up to this is layout noise
const MOVE_EPS = 1;
const SIZE_EPS = 0.5;

function drifted(from: DOMRect, to: DOMRect): boolean {
  return (
    Math.abs(to.left - from.left) > MOVE_EPS ||
    Math.abs(to.top - from.top) > MOVE_EPS ||
    Math.abs(to.width - from.width) > SIZE_EPS ||
    Math.abs(to.height - from.height) > SIZE_EPS
  );
}

function inViewport(win: Window, el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < win.innerHeight && r.right > 0 && r.left < win.innerWidth;
}

function reducedMotion(win: Window): boolean {
  if (typeof win.matchMedia !== "function") return false;
  return win.matchMedia("(prefers-reduced-motion: reduce)")?.matches === true;
}

export function createAnimator(opts: AnimatorOptions): Animator {
  const { win, quiet } = opts;
  const raf = opts.raf ?? ((cb: () => void) => win.requestAnimationFrame(() => cb()));
  const now = opts.now ?? (() => win.performance.now());
  const random = opts.random ?? Math.random;
  const active = new Set<Entry>();
  let scheduled = false;
  let listening = false;

  // scroll anchoring and inner scrollers fire these too: only blocks that really moved lose the overlay
  const finishDrifted = () => {
    const targets = [...active].filter((e) => e.effect.usesOverlay && e.startRect);
    if (targets.length === 0) return;
    const rects = targets.map((e) => e.ctx.block.getBoundingClientRect());
    const moved = targets.filter((e, i) => drifted(e.startRect as DOMRect, rects[i] as DOMRect));
    if (moved.length === 0) return;
    quiet(() => {
      for (const e of moved) finishEntry(e);
    });
  };

  const listen = (on: boolean) => {
    if (on === listening) return;
    listening = on;
    const method = on ? "addEventListener" : "removeEventListener";
    win[method]("scroll", finishDrifted, { capture: true, passive: true });
    win[method]("resize", finishDrifted, { passive: true });
  };

  const finishEntry = (e: Entry) => {
    if (e.done) return;
    e.done = true;
    active.delete(e);
    try {
      e.effect.finish(e.ctx);
    } catch {
      // fall through to the settle below
    }
    // Safety net: nodes we wrote and the page did not touch end up as `to`, even if detached.
    for (const c of e.changes) {
      const mine = e.lastWritten.get(c.node);
      if (mine !== undefined && c.node.data === mine && mine !== c.to) c.node.data = c.to;
    }
    e.releaseOverlay();
    if (e.effect.usesOverlay && ![...active].some((a) => a.effect.usesOverlay)) listen(false);
  };

  const tick = () => {
    scheduled = false;
    if (active.size === 0) return;
    quiet(() => {
      const t = now();
      // one shared canvas per document: wipe it once, every effect redraws its own state
      for (const e of active) {
        const o = e.overlay();
        if (o) {
          o.beginFrame();
          break;
        }
      }
      for (const e of [...active]) {
        let keep = false;
        try {
          keep = !!e.frame?.(t) && e.ctx.block.isConnected;
        } catch {
          keep = false;
        }
        if (!keep) finishEntry(e);
      }
    });
    schedule();
  };

  const schedule = () => {
    if (scheduled || active.size === 0) return;
    scheduled = true;
    raf(tick);
  };

  const heavyCount = () => {
    let n = 0;
    for (const e of active) if (e.effect.heavy) n++;
    return n;
  };

  // a background tab gets no rAF, blocks would stay in the start state
  const canAnimate = () => {
    const effect = registry[opts.kind()];
    if (!effect || effect.kind === "none") return null;
    if (reducedMotion(win)) return null;
    if (win.document.visibilityState === "hidden") return null;
    return effect;
  };

  return {
    inView(blocks) {
      const out = new Set<Element>();
      if (!canAnimate()) return out;
      for (const block of blocks) if (inViewport(win, block)) out.add(block);
      return out;
    },

    prepare(block, popts = {}) {
      const effect = canAnimate();
      if (!effect) return null;
      if (!(popts.visible ?? inViewport(win, block))) return null;
      if (active.size >= MAX_ACTIVE) return null;
      if (effect.heavy && heavyCount() >= MAX_ACTIVE_HEAVY) return null;
      const from = new Map<Text, string>();
      for (const node of textNodes(block)) from.set(node, node.data);
      let prepared: Prepared;
      try {
        prepared = effect.before?.(block, { bilingual: popts.bilingual ?? false });
      } catch {
        return null;
      }
      return { block, effect, prepared, from };
    },

    play(token, appliedRoot) {
      const changes: TextChange[] = [];
      for (const node of textNodes(appliedRoot)) {
        if (BLANK.test(node.data)) continue;
        const from = token.from.get(node) ?? "";
        if (from === node.data) continue;
        changes.push({ node, from, to: node.data });
      }
      if (changes.length === 0) return;

      const lastWritten = new WeakMap<Text, string>();
      const released = new WeakSet<Text>();
      const finals = new Map(changes.map((c) => [c.node, c.to]));
      let held: Overlay | null = null;
      const ctx: EffectContext = {
        block: appliedRoot,
        changes,
        bilingual: appliedRoot !== token.block,
        write(node, value) {
          if (released.has(node)) return false;
          // before the first write the node holds `to` (apply just wrote it)
          const expected = lastWritten.get(node) ?? finals.get(node);
          if (!node.isConnected || node.data !== expected) {
            released.add(node);
            return false;
          }
          node.data = value;
          lastWritten.set(node, value);
          return true;
        },
        overlay() {
          if (!token.effect.usesOverlay) return null;
          if (held) return held;
          const acquired = acquireOverlay(win);
          if (!acquired) return null;
          const handle: Overlay = {
            canvas: () => acquired.canvas(),
            layer: () => acquired.layer(),
            beginFrame: () => acquired.beginFrame(),
            release() {
              acquired.release();
              if (held === handle) held = null;
            },
          };
          held = handle;
          return handle;
        },
        now,
        random,
      };
      const entry: Entry = {
        effect: token.effect,
        ctx,
        frame: null,
        changes,
        lastWritten,
        overlay: () => held,
        releaseOverlay: () => held?.release(),
        startRect: null,
        done: false,
      };
      active.add(entry);
      if (token.effect.usesOverlay) listen(true);
      try {
        entry.frame = token.effect.start(ctx, token.prepared);
      } catch {
        finishEntry(entry);
        return;
      }
      if (token.effect.usesOverlay) entry.startRect = appliedRoot.getBoundingClientRect();
      schedule();
    },

    finishAll() {
      if (active.size === 0) return;
      quiet(() => {
        for (const e of [...active]) finishEntry(e);
      });
    },

    busy() {
      return active.size > 0;
    },

    finishWithin(el) {
      const targets = [...active].filter(
        (e) => e.ctx.block === el || el.contains(e.ctx.block) || e.ctx.block.contains(el),
      );
      if (targets.length === 0) return;
      quiet(() => {
        for (const e of targets) finishEntry(e);
      });
    },
  };
}
