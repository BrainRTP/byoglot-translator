import { fadeEffect } from "./fade";
import { lineBoxes, revealFront, revealKeyframes } from "./lines";
import type { Effect, EffectContext, Prepared } from "./types";
import { animate, cancelAll, END_MARGIN_MS, px, textNodes } from "./util";

const MAX_WORDS = 400;
const DUST_MS = 500;
const PEN_MAX_MS = 1600;
const PEN_MIN_MS = 400;
// pen speed: 2ms per px of text, capped
const MS_PER_PX = 2;
const MIN_PARTICLES = 6;
const MAX_PARTICLES = 14;
const MIN_SIZE = 1.5;
const MAX_SIZE = 3;
// px/s: sideways spread and upward speed range
const MAX_VX = 70;
const MIN_VY = 30;
const MAX_VY = 140;
// the old words fade out in the first part of the dust phase
const WORD_FADE = 0.2;
const DOT = 6;
const WORD = /\S+/g;

type Word = {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  font: string;
  color: string;
};

type Pen = { words: Word[] };

type Active = {
  anims: Animation[];
  dot: HTMLElement | null;
};

type State = Active | "fade";

const states = new WeakMap<EffectContext, State>();

function measure(block: Element): Word[] {
  const doc = block.ownerDocument;
  const win = doc.defaultView;
  const words: Word[] = [];
  if (!win) return words;
  for (const node of textNodes(block)) {
    if (words.length >= MAX_WORDS) break;
    const parent = node.parentElement;
    if (!parent || !node.data.trim()) continue;
    const style = win.getComputedStyle(parent);
    const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const range = doc.createRange();
    for (const m of node.data.matchAll(WORD)) {
      if (words.length >= MAX_WORDS) break;
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      const rect = Array.from(range.getClientRects()).find((x) => x.width > 0 && x.height > 0);
      if (!rect || rect.bottom < 0 || rect.top > win.innerHeight) continue;
      words.push({
        text: m[0],
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        font,
        color: style.color,
      });
    }
  }
  return words;
}

type Dust = { draw(ms: number): void };

function makeDust(canvas: CanvasRenderingContext2D, words: Word[], random: () => number): Dust {
  const starts = new Uint32Array(words.length + 1);
  let count = 0;
  for (let i = 0; i < words.length; i++) {
    starts[i] = count;
    count += MIN_PARTICLES + Math.floor(random() * (MAX_PARTICLES - MIN_PARTICLES + 1));
  }
  starts[words.length] = count;
  const x0 = new Float32Array(count);
  const y0 = new Float32Array(count);
  const vx = new Float32Array(count);
  const vy = new Float32Array(count);
  const size = new Float32Array(count);
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as Word;
    for (let k = starts[i] as number; k < (starts[i + 1] as number); k++) {
      x0[k] = w.left + random() * w.width;
      y0[k] = w.top + random() * w.height;
      vx[k] = (random() * 2 - 1) * MAX_VX;
      vy[k] = -(MIN_VY + random() * (MAX_VY - MIN_VY));
      size[k] = MIN_SIZE + random() * (MAX_SIZE - MIN_SIZE);
    }
  }
  const draw = (ms: number) => {
    const p = Math.min(Math.max(ms / DUST_MS, 0), 1);
    const s = ms / 1000;
    const textAlpha = 1 - p / WORD_FADE;
    canvas.textBaseline = "middle";
    canvas.textAlign = "left";
    for (let i = 0; i < words.length; i++) {
      const w = words[i] as Word;
      canvas.fillStyle = w.color;
      if (textAlpha > 0) {
        canvas.globalAlpha = textAlpha;
        canvas.font = w.font;
        canvas.fillText(w.text, w.left, w.top + w.height / 2);
      }
      canvas.globalAlpha = 1 - p;
      for (let k = starts[i] as number; k < (starts[i + 1] as number); k++) {
        canvas.fillRect(
          (x0[k] as number) + (vx[k] as number) * s,
          (y0[k] as number) + (vy[k] as number) * s,
          size[k] as number,
          size[k] as number,
        );
      }
    }
    canvas.globalAlpha = 1;
  };

  return { draw };
}

export const penEffect: Effect = {
  kind: "pen",
  usesOverlay: true,
  before(block, opts): Prepared {
    // bilingual keeps the old text on the page, the words would be discarded
    const pen: Pen = { words: opts.bilingual ? [] : measure(block) };
    return pen;
  },
  start(ctx, prepared) {
    const words = ctx.bilingual ? [] : ((prepared as Pen | undefined)?.words ?? []);
    const overlay = ctx.overlay();
    // the canvas is only needed for the dust, bilingual and empty blocks go without it
    const canvas = words.length > 0 ? (overlay?.canvas() ?? null) : null;
    if (!overlay || (words.length > 0 && !canvas)) {
      states.set(ctx, "fade");
      overlay?.release();
      return fadeEffect.start(ctx, prepared);
    }

    const dust = canvas ? makeDust(canvas, words, ctx.random) : null;
    const blockRect = ctx.block.getBoundingClientRect();
    const lines = lineBoxes(ctx.block);
    const total = lines.reduce((sum, l) => sum + Math.max(l.width, 0), 0);
    const penMs = Math.min(PEN_MAX_MS, Math.max(PEN_MIN_MS, Math.round(total * MS_PER_PX)));
    const active: Active = { anims: [], dot: null };
    states.set(ctx, active);

    const t0 = ctx.now();
    let phase: "dust" | "pen" = "dust";
    let penStart = t0;

    const moveDot = (p: number) => {
      if (!active.dot) return;
      const f = revealFront(blockRect, lines, p);
      active.dot.style.transform = `translate(${px(f.x - DOT / 2)}px, ${px(f.y - DOT / 2)}px)`;
    };

    const startPen = (now: number) => {
      phase = "pen";
      penStart = now;
      cancelAll(active.anims.splice(0));
      if (lines.length === 0) return;
      const keyframes = revealKeyframes(blockRect, lines);
      const reveal = animate(ctx.block, keyframes, penMs);
      if (reveal) active.anims.push(reveal);
      const layer = overlay.layer();
      const dot = layer.ownerDocument.createElement("div");
      const color = ctx.block.ownerDocument.defaultView?.getComputedStyle(ctx.block).color;
      dot.setAttribute(
        "style",
        `position:absolute;top:0;left:0;width:${DOT}px;height:${DOT}px;border-radius:50%;pointer-events:none;background:${color || "#000"}`,
      );
      layer.append(dot);
      active.dot = dot;
      moveDot(0);
    };

    if (dust) {
      // the page already holds the new text, keep it invisible until the pen
      const hide = animate(ctx.block, [{ opacity: 0 }, { opacity: 0 }], DUST_MS);
      if (hide) active.anims.push(hide);
      dust.draw(0);
    } else {
      startPen(t0);
    }

    return (now) => {
      if (phase === "dust") {
        if (now - t0 < DUST_MS) {
          dust?.draw(now - t0);
          return true;
        }
        startPen(now);
      }
      if (lines.length === 0) return false;
      const elapsed = now - penStart;
      if (elapsed >= penMs + END_MARGIN_MS) return false;
      moveDot(Math.min(elapsed / penMs, 1));
      return true;
    };
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
    state.dot?.remove();
    // the page text already holds `to`, nothing to write
  },
};
