import type { Lane } from "./layout";

export type { Lane };

export type Lanes<T> = {
  push(item: T, lane: Lane): void;
  size(ready?: (item: T) => boolean): number;
  filter(keep: (item: T) => boolean): void;
  reorder(fn: (items: T[]) => T[]): void;
  take(
    inflight: Record<Lane, number>,
    ready?: (item: T) => boolean,
  ): { lane: Lane; items: T[] } | null;
  clear(): void;
};

export function createLanes<T>(opts: { firstMainChunk: number; chunk: number }): Lanes<T> {
  const queues: Record<Lane, T[]> = { main: [], side: [] };
  let firstMainTaken = false;

  function takeFrom(lane: Lane, ready?: (item: T) => boolean) {
    const size = lane === "main" && !firstMainTaken ? opts.firstMainChunk : opts.chunk;
    if (lane === "main") firstMainTaken = true;
    if (!ready) return { lane, items: queues[lane].splice(0, size) };
    const items: T[] = [];
    queues[lane] = queues[lane].filter((i) => items.length >= size || !ready(i) || !items.push(i));
    return { lane, items };
  }

  return {
    push(item, lane) {
      queues[lane].push(item);
    },
    size: (ready) =>
      ready
        ? queues.main.filter(ready).length + queues.side.filter(ready).length
        : queues.main.length + queues.side.length,
    filter(keep) {
      queues.main = queues.main.filter(keep);
      queues.side = queues.side.filter(keep);
    },
    reorder(fn) {
      queues.main = fn(queues.main);
      queues.side = fn(queues.side);
    },
    take(inflight, ready) {
      const has = (q: T[]) => (ready ? q.some(ready) : q.length > 0);
      const hasMain = has(queues.main);
      const hasSide = has(queues.side);
      if (inflight.main === 0 && hasMain) return takeFrom("main", ready);
      if (inflight.side === 0 && hasSide) return takeFrom("side", ready);
      if (hasMain) return takeFrom("main", ready);
      if (hasSide) return takeFrom("side", ready);
      return null;
    },
    clear() {
      queues.main = [];
      queues.side = [];
      firstMainTaken = false;
    },
  };
}
