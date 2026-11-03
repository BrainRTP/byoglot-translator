import type { Segment } from "./types.ts";

const FIRST_CHUNK = 10;
const QUEUE_CHUNK = 50;

export function packBatches(segments: Segment[], maxBlocks: number, maxChars: number): Segment[][] {
  const batches: Segment[][] = [];
  for (let start = 0; start < segments.length; ) {
    const end = start + (start === 0 ? FIRST_CHUNK : QUEUE_CHUNK);
    let current: Segment[] = [];
    let chars = 0;
    for (const s of segments.slice(start, end)) {
      if (
        current.length > 0 &&
        (current.length + 1 > maxBlocks || chars + s.text.length > maxChars)
      ) {
        batches.push(current);
        current = [];
        chars = 0;
      }
      current.push(s);
      chars += s.text.length;
    }
    if (current.length > 0) batches.push(current);
    start = end;
  }
  return batches;
}
