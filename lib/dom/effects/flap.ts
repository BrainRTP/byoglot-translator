import type { Effect, EffectContext } from "./types";

const STEP_MS = 45;
const MAX_STEPS = 10;
const STAGGER_MS = 12;
const MAX_TOTAL_MS = 1600;

const SET = " ABCDEFGHIJKLMNOPQRSTUVWXYZАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ0123456789.,:;!?-";
const SIZE = SET.length;
const UPPER = [...SET];
const LOWER = UPPER.map((ch) => ch.toLowerCase());
// both cases of every set char map to its index
const INDEX = new Map<string, number>();
UPPER.forEach((ch, i) => {
  INDEX.set(ch, i);
  INDEX.set(LOWER[i] as string, i);
});

// whitespace targets are never flipped, word gaps stay put
const WHITESPACE = /^\s$/;

const NOT_PAINTED = 255;

type NodeState = {
  node: Text;
  to: string;
  // per UTF-16 position
  delay: Uint16Array;
  steps: Uint8Array;
  source: Uint8Array;
  start: Uint8Array;
  lower: Uint8Array;
  shown: Uint8Array;
  parts: string[];
  released: boolean;
};

type State = {
  t0: number;
  end: number;
  nodes: NodeState[];
};

function glyph(ns: NodeState, i: number, k: number): string {
  if (k === ns.steps[i]) return ns.to[i] as string;
  const idx = k === 0 ? (ns.source[i] as number) : ((ns.start[i] as number) + k) % SIZE;
  return (ns.lower[i] ? LOWER : UPPER)[idx] as string;
}

function paint(ctx: EffectContext, state: State, now: number) {
  const elapsed = now - state.t0;
  for (const ns of state.nodes) {
    if (ns.released) continue;
    let dirty = false;
    for (let i = 0; i < ns.to.length; i++) {
      const since = elapsed - (ns.delay[i] as number);
      const k = since < 0 ? 0 : Math.min(ns.steps[i] as number, Math.floor(since / STEP_MS));
      if (k === ns.shown[i]) continue;
      ns.shown[i] = k;
      ns.parts[i] = glyph(ns, i, k);
      dirty = true;
    }
    if (dirty && !ctx.write(ns.node, ns.parts.join(""))) ns.released = true;
  }
}

export const flapEffect: Effect = {
  kind: "flap",
  start(ctx) {
    let total = 0;
    for (const c of ctx.changes) total += c.to.length;
    const stagger =
      total > 1
        ? Math.min(STAGGER_MS, (MAX_TOTAL_MS - MAX_STEPS * STEP_MS) / (total - 1))
        : STAGGER_MS;
    let end = 0;
    let g = 0;
    const nodes: NodeState[] = ctx.changes.map((c) => {
      const n = c.to.length;
      const ns: NodeState = {
        node: c.node,
        to: c.to,
        delay: new Uint16Array(n),
        steps: new Uint8Array(n),
        source: new Uint8Array(n),
        start: new Uint8Array(n),
        lower: new Uint8Array(n),
        shown: new Uint8Array(n).fill(NOT_PAINTED),
        parts: new Array<string>(n),
        released: false,
      };
      for (let i = 0; i < n; i++, g++) {
        const ch = c.to[i] as string;
        const target = WHITESPACE.test(ch) ? undefined : INDEX.get(ch);
        if (target === undefined) continue;
        // a source outside the set or past the end counts as a blank
        const source = INDEX.get(c.from[i] ?? " ") ?? 0;
        const steps = Math.min(MAX_STEPS, (target - source + SIZE) % SIZE);
        if (steps === 0) continue;
        const delay = Math.floor(g * stagger);
        ns.delay[i] = delay;
        ns.steps[i] = steps;
        ns.source[i] = source;
        ns.start[i] = (target - steps + SIZE) % SIZE;
        ns.lower[i] = ch === LOWER[target] && ch !== UPPER[target] ? 1 : 0;
        end = Math.max(end, delay + steps * STEP_MS);
      }
      return ns;
    });
    const state: State = { t0: ctx.now(), end, nodes };
    paint(ctx, state, state.t0);
    return (now) => {
      if (now - state.t0 >= state.end) {
        paint(ctx, state, state.t0 + state.end);
        return false;
      }
      paint(ctx, state, now);
      return true;
    };
  },
  finish(ctx) {
    // write() refuses nodes the page touched
    for (const c of ctx.changes) ctx.write(c.node, c.to);
  },
};
