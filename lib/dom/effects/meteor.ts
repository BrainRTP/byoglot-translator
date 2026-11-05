import { fadeEffect } from "./fade";
import {
  FLIGHT_MS,
  type Glyph,
  type Meteor,
  meteorAt,
  type Particle,
  STAGGER_MS,
  spawnFalling,
  spawnMeteors,
  step,
} from "./meteor-physics";
import type { Effect, EffectContext, Prepared } from "./types";
import { animate, cancelAll, END_MARGIN_MS, textNodes } from "./util";

const MAX_CHARS = 600;
const FALL_MS = 1200;
const RAIN_MS = STAGGER_MS + FLIGHT_MS;
const OVERLAP_MS = 300;
const REVEAL_MS = 150;
const TAIL = 8;
// share of the flight between two tail points
const TAIL_STEP = 0.025;
const TAIL_SIZE = 2;
const ANY = /\S/gu;
const WORD = /\S+/g;

type Meteors = { old: Glyph[] };

type Active = { anims: Animation[] };

type State = Active | "fade";

const states = new WeakMap<EffectContext, State>();

// characters of the block with their screen centers; past MAX_CHARS the units are words
function measure(block: Element): Glyph[] {
  const doc = block.ownerDocument;
  const win = doc.defaultView;
  const out: Glyph[] = [];
  if (!win) return out;
  const nodes = textNodes(block).filter((n) => n.data.trim() && n.parentElement);
  const total = nodes.reduce((sum, n) => sum + (n.data.match(ANY)?.length ?? 0), 0);
  const unit = total > MAX_CHARS ? WORD : ANY;
  const range = doc.createRange();
  for (const node of nodes) {
    if (out.length >= MAX_CHARS) break;
    const style = win.getComputedStyle(node.parentElement as Element);
    const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    for (const m of node.data.matchAll(unit)) {
      if (out.length >= MAX_CHARS) break;
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      const rect = Array.from(range.getClientRects()).find((x) => x.width > 0 && x.height > 0);
      if (!rect || rect.bottom < 0 || rect.top > win.innerHeight) continue;
      out.push({
        ch: m[0],
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        font,
        color: style.color,
      });
    }
  }
  return out;
}

function drawGlyph(
  c: CanvasRenderingContext2D,
  g: { ch: string; font: string; color: string },
  x: number,
  y: number,
  angle: number | null,
  alpha: number,
) {
  c.globalAlpha = alpha;
  c.fillStyle = g.color;
  c.font = g.font;
  if (angle === null) {
    c.fillText(g.ch, x, y);
    return;
  }
  c.save();
  c.translate(x, y);
  c.rotate(angle);
  c.fillText(g.ch, 0, 0);
  c.restore();
}

function drawMeteor(c: CanvasRenderingContext2D, m: Meteor, rainMs: number, alpha: number) {
  const t = (rainMs - m.delay) / FLIGHT_MS;
  if (t < 0) return;
  if (t >= 1) {
    drawGlyph(c, m, m.to.x, m.to.y, null, alpha);
    return;
  }
  const head = meteorAt(m.from, m.to, t);
  drawGlyph(c, m, head.x, head.y, null, alpha);
  c.fillStyle = m.color;
  for (let k = 1; k <= TAIL; k++) {
    const tail = t - k * TAIL_STEP;
    if (tail < 0) break;
    const p = meteorAt(m.from, m.to, tail);
    c.globalAlpha = alpha * (1 - k / (TAIL + 1)) * 0.6;
    c.fillRect(p.x - TAIL_SIZE / 2, p.y - TAIL_SIZE / 2, TAIL_SIZE, TAIL_SIZE);
  }
}

export const meteorEffect: Effect = {
  kind: "meteor",
  heavy: true,
  usesOverlay: true,
  before(block, opts): Prepared {
    // bilingual keeps the old text on the page, nothing falls
    const prepared: Meteors = { old: opts.bilingual ? [] : measure(block) };
    return prepared;
  },
  start(ctx, prepared) {
    const old = ctx.bilingual ? [] : ((prepared as Meteors | undefined)?.old ?? []);
    // the page already holds the new text
    const targets = measure(ctx.block);
    const overlay = ctx.overlay();
    const canvas = overlay?.canvas() ?? null;
    if (!overlay || !canvas || (old.length === 0 && targets.length === 0)) {
      states.set(ctx, "fade");
      overlay?.release();
      return fadeEffect.start(ctx, prepared);
    }

    const win = ctx.block.ownerDocument.defaultView;
    const height = win?.innerHeight ?? 0;
    const active: Active = { anims: [] };
    states.set(ctx, active);

    const t0 = ctx.now();
    const rainAt = t0 + (old.length > 0 ? FALL_MS - OVERLAP_MS : 0);
    const meteors = spawnMeteors(targets, 0, ctx.random);
    let particles: Particle[] = spawnFalling(old, ctx.random);
    let last = t0;
    let revealAt = 0;

    const hide = animate(ctx.block, [{ opacity: 0 }, { opacity: 0 }], rainAt - t0 + RAIN_MS);
    if (hide) active.anims.push(hide);

    const render = (now: number): boolean => {
      canvas.textAlign = "center";
      canvas.textBaseline = "middle";
      const rainMs = now - rainAt;
      if (!revealAt && rainMs >= RAIN_MS) {
        revealAt = now;
        const reveal = animate(ctx.block, [{ opacity: 0 }, { opacity: 1 }], REVEAL_MS);
        if (reveal) active.anims.push(reveal);
        if (hide) cancelAll([hide]);
      }
      if (revealAt) {
        const spent = now - revealAt;
        if (spent >= REVEAL_MS + END_MARGIN_MS) return false;
        // the letters on the canvas fade out while the block fades in
        const alpha = 1 - Math.min(spent / REVEAL_MS, 1);
        for (const m of meteors) drawMeteor(canvas, m, RAIN_MS, alpha);
        canvas.globalAlpha = 1;
        return true;
      }
      if (now - t0 >= FALL_MS) particles = [];
      else particles = step(particles, (now - last) / 1000, height);
      last = now;
      for (const p of particles) drawGlyph(canvas, p, p.x, p.y, p.angle, 1);
      for (const m of meteors) drawMeteor(canvas, m, rainMs, 1);
      canvas.globalAlpha = 1;
      return true;
    };

    render(t0);
    return render;
  },
  finish(ctx) {
    const state = states.get(ctx);
    states.delete(ctx);
    if (state === "fade") {
      fadeEffect.finish(ctx);
      return;
    }
    if (!state) return;
    cancelAll(state.anims.splice(0));
    // the page text already holds `to`, nothing to write
  },
};
