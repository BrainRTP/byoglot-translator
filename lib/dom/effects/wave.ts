import { fadeEffect } from "./fade";
import { lineBoxes, revealFront, revealKeyframes } from "./lines";
import type { Effect, EffectContext } from "./types";
import { animate, cancelAll, END_MARGIN_MS, px, writeAll } from "./util";

const SHINE_MS = 350;
const WAVE_MAX_MS = 1200;
const WAVE_MIN_MS = 400;
// wave speed: 1.5ms per px of text, clamped
const MS_PER_PX = 1.5;
const BAND_SHARE = 0.3;
const GRADIENT = "linear-gradient(90deg, transparent, rgba(255,255,255,.3), transparent)";

type Active = {
  anims: Animation[];
  clip: HTMLElement | null;
  band: HTMLElement | null;
};

type State = Active | "fade";

const states = new WeakMap<EffectContext, State>();

function dropBand(active: Active) {
  active.clip?.remove();
  active.clip = null;
  active.band = null;
}

export const waveEffect: Effect = {
  kind: "wave",
  usesOverlay: true,
  start(ctx, prepared) {
    const overlay = ctx.overlay();
    if (!overlay) {
      states.set(ctx, "fade");
      return fadeEffect.start(ctx, prepared);
    }

    const active: Active = { anims: [], clip: null, band: null };
    states.set(ctx, active);
    const layer = overlay.layer();

    // the clip box sits over the block rect, the band slides inside it
    const placeBand = (blockRect: DOMRect) => {
      if (!active.clip || !active.band) {
        const clip = layer.ownerDocument.createElement("div");
        const band = layer.ownerDocument.createElement("div");
        clip.append(band);
        layer.append(clip);
        active.clip = clip;
        active.band = band;
        band.setAttribute(
          "style",
          `position:absolute;top:0;left:0;pointer-events:none;background:${GRADIENT}`,
        );
      }
      active.clip.setAttribute(
        "style",
        `position:absolute;overflow:hidden;pointer-events:none;left:${px(blockRect.left)}px;top:${px(blockRect.top)}px;width:${px(blockRect.width)}px;height:${px(blockRect.height)}px`,
      );
      active.band.style.width = `${px(blockRect.width * BAND_SHARE)}px`;
    };

    const moveBand = (x: number, y: number, height: number) => {
      if (!active.band) return;
      active.band.style.height = `${px(height)}px`;
      active.band.style.transform = `translate(${px(x)}px, ${px(y)}px)`;
    };

    const t0 = ctx.now();
    let phase: "shine" | "wave" = "shine";
    let waveStart = t0;
    let waveMs = WAVE_MIN_MS;
    let blockRect: DOMRect = ctx.block.getBoundingClientRect();
    let lines: DOMRect[] = [];

    const shineAt = (p: number) => {
      const w = blockRect.width * BAND_SHARE;
      moveBand(-w + (blockRect.width + w) * p, 0, blockRect.height);
    };

    const waveAt = (p: number) => {
      const f = revealFront(blockRect, lines, p);
      const line = lines[f.index];
      if (!line) return;
      const w = blockRect.width * BAND_SHARE;
      moveBand(f.x - blockRect.left - w / 2, line.top - blockRect.top, line.height);
    };

    const startWave = (now: number) => {
      phase = "wave";
      waveStart = now;
      if (!ctx.bilingual) writeAll(ctx, "to");
      blockRect = ctx.block.getBoundingClientRect();
      lines = lineBoxes(ctx.block);
      if (lines.length === 0) {
        dropBand(active);
        return;
      }
      const total = lines.reduce((sum, l) => sum + Math.max(l.width, 0), 0);
      waveMs = Math.min(WAVE_MAX_MS, Math.max(WAVE_MIN_MS, Math.round(total * MS_PER_PX)));
      const reveal = animate(ctx.block, revealKeyframes(blockRect, lines), waveMs);
      if (reveal) active.anims.push(reveal);
      placeBand(blockRect);
      waveAt(0);
    };

    if (ctx.bilingual) {
      startWave(t0);
    } else {
      // the page already holds `to`, bring the old text back under the shine
      writeAll(ctx, "from");
      blockRect = ctx.block.getBoundingClientRect();
      placeBand(blockRect);
      shineAt(0);
    }

    return (now) => {
      if (phase === "shine") {
        if (now - t0 < SHINE_MS) {
          shineAt((now - t0) / SHINE_MS);
          return true;
        }
        startWave(now);
      }
      if (lines.length === 0) return false;
      const elapsed = now - waveStart;
      if (elapsed >= waveMs + END_MARGIN_MS) {
        dropBand(active);
        return false;
      }
      waveAt(Math.min(elapsed / waveMs, 1));
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
    dropBand(state);
    // finishing inside the shine phase: the old text is still on the page
    writeAll(ctx, "to");
  },
};
