import type { Effect } from "./types";

const ERASE_MS = 300;
const PAUSE_MS = 120;
const TYPE_MS = 1400;
const BLINK_MS = 500;
// U+258D
const CARET = "▍";

function head(s: string, n: number): string {
  // never cut a surrogate pair in half
  const high = n > 0 && n < s.length && (s.charCodeAt(n - 1) & 0xfc00) === 0xd800;
  return s.slice(0, high ? n + 1 : n);
}

// chars to move this frame: the time-proportional share, at least one, all of them at the deadline
function budget(total: number, left: number, now: number, start: number, end: number): number {
  if (now >= end) return left;
  const target = Math.ceil((total * (now - start)) / (end - start));
  return Math.min(left, Math.max(1, target - (total - left)));
}

export const typewriterEffect: Effect = {
  kind: "typewriter",
  start(ctx) {
    const { changes } = ctx;
    const n = changes.length;
    const to = changes.map((c) => c.to);
    const from = changes.map((c) => (ctx.bilingual ? "" : c.from));
    const vis = new Int32Array(n);
    // chars left in the current phase, per node
    const rem = new Int32Array(n);
    const released = new Uint8Array(n);
    const last = to.slice();
    const dirty = new Set<number>();
    let live = n;
    let src = from;
    let caret = -1;
    let caretOn = true;
    let total = 0;
    let left = 0;
    let phase: "erase" | "pause" | "type" = "erase";
    let eraseEnd = 0;
    let pauseStart = 0;
    let typeStart = 0;
    let typeEnd = 0;
    let ei = n - 1;
    let ci = 0;
    let typed = -1;

    const text = (i: number) =>
      head(src[i] as string, vis[i] as number) + (i === caret && caretOn ? CARET : "");

    const drop = (i: number) => {
      released[i] = 1;
      live--;
      total -= rem[i] as number;
      left -= rem[i] as number;
      rem[i] = 0;
    };

    // true when a write was refused
    const flush = (): boolean => {
      let dropped = false;
      for (const i of dirty) {
        if (released[i]) continue;
        const value = text(i);
        if (value === last[i]) continue;
        if (ctx.write((changes[i] as (typeof changes)[number]).node, value)) last[i] = value;
        else {
          drop(i);
          dropped = true;
        }
      }
      dirty.clear();
      return dropped;
    };

    const setCaret = (j: number) => {
      if (j === caret) return;
      if (caret >= 0) dirty.add(caret);
      caret = j;
      if (j >= 0) dirty.add(j);
    };

    const firstLive = () => {
      for (let i = 0; i < n; i++) if (!released[i]) return i;
      return -1;
    };

    const arm = (lengths: string[]) => {
      total = 0;
      for (let i = 0; i < n; i++) {
        rem[i] = released[i] ? 0 : (lengths[i] as string).length;
        total += rem[i] as number;
      }
      left = total;
    };

    const toPause = (now: number) => {
      phase = "pause";
      pauseStart = now;
      typeStart = now + PAUSE_MS;
      typeEnd = typeStart + TYPE_MS;
      src = to;
      for (let i = 0; i < n; i++) vis[i] = 0;
      arm(to);
      caretOn = true;
      setCaret(firstLive());
    };

    const stepErase = (now: number) => {
      let b = budget(total, left, now, t0, eraseEnd);
      while (b > 0 && ei >= 0) {
        if (released[ei] || !rem[ei]) {
          ei--;
          continue;
        }
        const take = Math.min(b, rem[ei] as number);
        rem[ei] = (rem[ei] as number) - take;
        vis[ei] = (vis[ei] as number) - take;
        left -= take;
        b -= take;
        dirty.add(ei);
      }
      while (ei >= 0 && (released[ei] || !rem[ei])) ei--;
      setCaret(ei >= 0 ? ei : firstLive());
    };

    const stepType = (now: number) => {
      let b = budget(total, left, now, typeStart, typeEnd);
      while (b > 0 && ci < n) {
        if (released[ci] || !rem[ci]) {
          ci++;
          continue;
        }
        const take = Math.min(b, rem[ci] as number);
        rem[ci] = (rem[ci] as number) - take;
        vis[ci] = (vis[ci] as number) + take;
        left -= take;
        b -= take;
        typed = ci;
        dirty.add(ci);
      }
      setCaret(left > 0 ? typed : -1);
    };

    // a refused write drops a node, so go on with the next one in the same frame
    const run = (step: () => void) => {
      let dropped: boolean;
      do {
        step();
        dropped = flush();
      } while (dropped && left > 0);
    };

    const t0 = ctx.now();
    eraseEnd = t0 + ERASE_MS;
    if (!ctx.bilingual) arm(from);
    for (let i = 0; i < n; i++) vis[i] = rem[i] as number;
    if (left > 0) {
      for (let i = 0; i < n; i++) dirty.add(i);
      flush();
    } else {
      toPause(t0);
      for (let i = 0; i < n; i++) dirty.add(i);
      flush();
    }

    return (now) => {
      if (live === 0) return false;
      if (phase === "erase") {
        run(() => stepErase(now));
        if (left === 0) {
          toPause(now);
          flush();
        }
        return live > 0;
      }
      if (phase === "pause") {
        if (now < typeStart) {
          setCaret(firstLive());
          const on = (now - pauseStart) % BLINK_MS < BLINK_MS / 2;
          if (on !== caretOn) {
            caretOn = on;
            if (caret >= 0) dirty.add(caret);
          }
          flush();
          return true;
        }
        phase = "type";
        caretOn = true;
      }
      run(() => stepType(now));
      return left > 0;
    };
  },
  finish(ctx) {
    // write() refuses nodes the page touched
    for (const c of ctx.changes) ctx.write(c.node, c.to);
  },
};
