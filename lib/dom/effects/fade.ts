import type { Effect, EffectContext } from "./types";
import { animate, cancelAll, END_MARGIN_MS, writeAll } from "./util";

const OUT_MS = 180;
const IN_MS = 320;
const IN_ONLY_MS = 400;

type State = {
  phase: "out" | "in";
  until: number;
  anims: Animation[];
};

const states = new WeakMap<EffectContext, State>();

function run(
  ctx: EffectContext,
  state: State,
  keyframes: Keyframe[],
  duration: number,
  easing: string,
) {
  const anim = animate(ctx.block, keyframes, duration, easing);
  if (anim) state.anims.push(anim);
}

export const fadeEffect: Effect = {
  kind: "fade",
  start(ctx) {
    const state: State = { phase: "in", until: 0, anims: [] };
    states.set(ctx, state);
    const t0 = ctx.now();
    if (ctx.bilingual) {
      state.until = t0 + IN_ONLY_MS;
      run(ctx, state, [{ opacity: 0 }, { opacity: 1 }], IN_ONLY_MS, "ease-out");
    } else {
      state.phase = "out";
      state.until = t0 + OUT_MS;
      writeAll(ctx, "from");
      run(ctx, state, [{ opacity: 1 }, { opacity: 0 }], OUT_MS, "ease-in");
    }
    return (now) => {
      if (now < state.until + END_MARGIN_MS) return true;
      if (state.phase === "in") return false;
      writeAll(ctx, "to");
      state.phase = "in";
      state.until = now + IN_MS;
      run(ctx, state, [{ opacity: 0 }, { opacity: 1 }], IN_MS, "ease-out");
      return true;
    };
  },
  finish(ctx) {
    const state = states.get(ctx);
    states.delete(ctx);
    cancelAll(state?.anims ?? []);
    writeAll(ctx, "to");
  },
};
