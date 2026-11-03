import type { EffectContext } from "./types";

const SHOW_TEXT = 4;

// WAAPI starts about a frame after the frame time we count from: end phases this much later so cancel never snaps
export const END_MARGIN_MS = 16;

export function textNodes(root: Element): Text[] {
  const walker = root.ownerDocument.createTreeWalker(root, SHOW_TEXT);
  const out: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  return out;
}

export function px(v: number): number {
  return Math.round(v * 100) / 100;
}

// WAAPI is only the visual layer, timing comes from frame time
export function animate(
  el: Element,
  keyframes: Keyframe[],
  duration: number,
  easing = "linear",
): Animation | null {
  if (typeof el.animate !== "function") return null;
  try {
    return el.animate(keyframes, { duration, easing, fill: "forwards" });
  } catch {
    return null;
  }
}

export function cancelAll(anims: Animation[]) {
  for (const a of anims) {
    try {
      a.cancel();
    } catch {
      // already gone
    }
  }
}

export function writeAll(ctx: EffectContext, key: "from" | "to") {
  for (const c of ctx.changes) ctx.write(c.node, c[key]);
}
