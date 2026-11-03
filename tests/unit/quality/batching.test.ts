import { describe, expect, it } from "vitest";
import { packBatches } from "../../quality/lib/batching.ts";
import type { Segment } from "../../quality/lib/types.ts";

const seg = (n: number, len: number): Segment => ({
  id: `b${n}`,
  text: "a".repeat(len),
  slots: {},
});
const many = (count: number, len: number) =>
  Array.from({ length: count }, (_, i) => seg(i + 1, len));

describe("packBatches", () => {
  it("cuts a first queue chunk of 10, then chunks of 50 split into batches of 25", () => {
    const sizes = packBatches(many(70, 10), 25, 4000).map((b) => b.length);
    expect(sizes).toEqual([10, 25, 25, 10]);
  });

  it("keeps blocks over the char budget one per batch", () => {
    const sizes = packBatches(many(3, 3000), 25, 4000).map((b) => b.length);
    expect(sizes).toEqual([1, 1, 1]);
  });

  it("starts a new batch at a chunk boundary even when the batch has room", () => {
    const sizes = packBatches(many(65, 10), 50, 8000).map((b) => b.length);
    expect(sizes).toEqual([10, 50, 5]);
  });
});
