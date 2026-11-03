import { describe, expect, it } from "vitest";
import { createLanes } from "../../../lib/dom/lanes";

const range = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

function setup(main: number, side: number) {
  const lanes = createLanes<string>({ firstMainChunk: 10, chunk: 50 });
  for (const m of range("m", main)) lanes.push(m, "main");
  for (const s of range("s", side)) lanes.push(s, "side");
  return lanes;
}

describe("createLanes", () => {
  it("serves article 30 + sidebar 70 across the lanes", () => {
    const lanes = setup(30, 70);
    expect(lanes.size()).toBe(100);

    const a = lanes.take({ main: 0, side: 0 });
    expect(a?.lane).toBe("main");
    expect(a?.items).toHaveLength(10);

    const b = lanes.take({ main: 1, side: 0 });
    expect(b?.lane).toBe("side");
    expect(b?.items).toHaveLength(50);

    const c = lanes.take({ main: 0, side: 1 });
    expect(c?.lane).toBe("main");
    expect(c?.items).toHaveLength(20);

    const d = lanes.take({ main: 0, side: 1 });
    expect(d?.lane).toBe("side");
    expect(d?.items).toHaveLength(20);

    expect(lanes.take({ main: 0, side: 0 })).toBeNull();
    expect(lanes.size()).toBe(0);
  });

  it("keeps serving main when there is no side lane", () => {
    const lanes = setup(120, 0);
    expect(lanes.take({ main: 0, side: 0 })?.items).toHaveLength(10);
    const a = lanes.take({ main: 1, side: 0 });
    const b = lanes.take({ main: 1, side: 0 });
    expect(a?.lane).toBe("main");
    expect(b?.lane).toBe("main");
    expect(a?.items).toHaveLength(50);
  });

  it("falls back to side when main is empty and main is in flight", () => {
    const lanes = setup(0, 5);
    expect(lanes.take({ main: 1, side: 1 })).toEqual({ lane: "side", items: range("s", 5) });
  });

  it("clear() brings back the small first chunk", () => {
    const lanes = setup(100, 0);
    expect(lanes.take({ main: 0, side: 0 })?.items).toHaveLength(10);
    expect(lanes.take({ main: 0, side: 0 })?.items).toHaveLength(50);
    lanes.clear();
    expect(lanes.size()).toBe(0);
    for (const m of range("m", 100)) lanes.push(m, "main");
    expect(lanes.take({ main: 0, side: 0 })?.items).toHaveLength(10);
  });

  it("reorder applies to each lane separately", () => {
    const lanes = createLanes<string>({ firstMainChunk: 10, chunk: 50 });
    lanes.push("m1", "main");
    lanes.push("s1", "side");
    lanes.push("m2", "main");
    lanes.push("s2", "side");
    lanes.reorder((items) => [...items].reverse());
    expect(lanes.take({ main: 0, side: 1 })).toEqual({ lane: "main", items: ["m2", "m1"] });
    expect(lanes.take({ main: 0, side: 1 })).toEqual({ lane: "side", items: ["s2", "s1"] });
  });

  it("filter removes items from both lanes", () => {
    const lanes = createLanes<string>({ firstMainChunk: 10, chunk: 50 });
    lanes.push("m1", "main");
    lanes.push("x", "main");
    lanes.push("s1", "side");
    lanes.push("x", "side");
    lanes.filter((i) => i !== "x");
    expect(lanes.size()).toBe(2);
    expect(lanes.take({ main: 0, side: 0 })).toEqual({ lane: "main", items: ["m1"] });
    expect(lanes.take({ main: 0, side: 0 })).toEqual({ lane: "side", items: ["s1"] });
  });
});
