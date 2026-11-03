import type { Effect } from "./types";

export const noneEffect: Effect = {
  kind: "none",
  start(ctx) {
    for (const c of ctx.changes) ctx.write(c.node, c.to);
    return () => false;
  },
  finish(ctx) {
    for (const c of ctx.changes) ctx.write(c.node, c.to);
  },
};
