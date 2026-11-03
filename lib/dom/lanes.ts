import type { Lane } from "./layout";

export type { Lane };

export type Lanes<T> = {
  push(item: T, lane: Lane): void;
  size(): number;
  filter(keep: (item: T) => boolean): void;
  reorder(fn: (items: T[]) => T[]): void;
  take(inflight: Record<Lane, number>): { lane: Lane; items: T[] } | null;
  clear(): void;
};

export function createLanes<T>(opts: { firstMainChunk: number; chunk: number }): Lanes<T> {
  const queues: Record<Lane, T[]> = { main: [], side: [] };
  let firstMainTaken = false;

  function takeFrom(lane: Lane) {
    const size = lane === "main" && !firstMainTaken ? opts.firstMainChunk : opts.chunk;
    if (lane === "main") firstMainTaken = true;
    return { lane, items: queues[lane].splice(0, size) };
  }

  return {
    push(item, lane) {
      queues[lane].push(item);
    },
    size: () => queues.main.length + queues.side.length,
    filter(keep) {
      queues.main = queues.main.filter(keep);
      queues.side = queues.side.filter(keep);
    },
    reorder(fn) {
      queues.main = fn(queues.main);
      queues.side = fn(queues.side);
    },
    take(inflight) {
      const hasMain = queues.main.length > 0;
      const hasSide = queues.side.length > 0;
      if (inflight.main === 0 && hasMain) return takeFrom("main");
      if (inflight.side === 0 && hasSide) return takeFrom("side");
      if (hasMain) return takeFrom("main");
      if (hasSide) return takeFrom("side");
      return null;
    },
    clear() {
      queues.main = [];
      queues.side = [];
      firstMainTaken = false;
    },
  };
}
