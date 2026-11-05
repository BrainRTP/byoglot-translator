import { afterEach, describe, expect, it, vi } from "vitest";
import {
  lineBoxes,
  revealFront,
  revealKeyframes,
  revealSpans,
} from "../../../../lib/dom/effects/lines";

function r(left: number, top: number, width: number, height: number): DOMRect {
  return new DOMRect(left, top, width, height);
}

function stubRects(byText: Record<string, DOMRect[]>) {
  vi.spyOn(Range.prototype, "getClientRects").mockImplementation(function (this: Range) {
    const rects = byText[this.startContainer.textContent ?? ""] ?? [];
    return rects as unknown as DOMRectList;
  });
}

function box(left: number, top: number, right: number, bottom: number) {
  return { left, top, right, bottom };
}

function pick(d: DOMRect) {
  return { left: d.left, top: d.top, right: d.right, bottom: d.bottom };
}

afterEach(() => vi.restoreAllMocks());

describe("lineBoxes", () => {
  it("merges rects of one visual line across text nodes", () => {
    document.body.innerHTML = "<p>Hello <b>big</b> world</p>";
    stubRects({
      "Hello ": [r(0, 0, 40, 20)],
      big: [r(40, 2, 20, 18)],
      " world": [r(60, 0, 50, 20)],
    });
    const lines = lineBoxes(document.body.firstElementChild as Element);
    expect(lines.map(pick)).toEqual([box(0, 0, 110, 20)]);
  });

  it("splits lines and sorts them top to bottom", () => {
    document.body.innerHTML = "<p>first second</p>";
    stubRects({ "first second": [r(0, 40, 30, 20), r(0, 0, 100, 20), r(0, 20, 60, 20)] });
    const lines = lineBoxes(document.body.firstElementChild as Element);
    expect(lines.map(pick)).toEqual([box(0, 0, 100, 20), box(0, 20, 60, 40), box(0, 40, 30, 60)]);
  });

  it("does not merge lines that only overlap by a few px", () => {
    document.body.innerHTML = "<p>a b</p>";
    stubRects({ "a b": [r(0, 0, 50, 22), r(0, 20, 50, 22)] });
    expect(lineBoxes(document.body.firstElementChild as Element)).toHaveLength(2);
  });

  it("skips empty rects and blank text", () => {
    document.body.innerHTML = "<p>x <i> </i>y</p>";
    stubRects({
      "x ": [r(0, 0, 0, 20), r(0, 0, 10, 20)],
      " ": [r(10, 0, 4, 20)],
      y: [r(14, 0, 8, 20)],
    });
    const lines = lineBoxes(document.body.firstElementChild as Element);
    expect(lines.map(pick)).toEqual([box(0, 0, 22, 20)]);
  });

  it("returns nothing for an element without text", () => {
    document.body.innerHTML = "<p></p>";
    expect(lineBoxes(document.body.firstElementChild as Element)).toEqual([]);
  });
});

function vertices(clipPath: unknown): string[] {
  const m = /^polygon\((.*)\)$/.exec(String(clipPath));
  if (!m) throw new Error(`not a polygon: ${clipPath}`);
  return (m[1] ?? "").split(",").map((s) => s.trim());
}

describe("revealKeyframes", () => {
  const block = r(100, 50, 200, 80);
  const lines = [r(100, 50, 200, 20), r(100, 70, 100, 20), r(100, 90, 50, 20)];

  it("gives two keyframes per line plus the final open one, six vertices each", () => {
    const frames = revealKeyframes(block, lines);
    expect(frames).toHaveLength(7);
    for (const f of frames) expect(vertices(f.clipPath)).toHaveLength(6);
  });

  it("opens everything above the line plus the line up to x, padded outward", () => {
    const frames = revealKeyframes(block, lines);
    expect(vertices(frames[2]?.clipPath)).toEqual([
      "-24px -24px",
      "224px -24px",
      "224px 20px",
      "0px 20px",
      "0px 40px",
      "-24px 40px",
    ]);
    expect(vertices(frames[3]?.clipPath)).toEqual([
      "-24px -24px",
      "224px -24px",
      "224px 20px",
      "100px 20px",
      "100px 40px",
      "-24px 40px",
    ]);
  });

  it("spreads offsets by line width, monotone from 0 to 1", () => {
    const offsets = revealKeyframes(block, lines).map((f) => f.offset as number);
    expect(offsets[0]).toBe(0);
    expect(offsets.at(-1)).toBe(1);
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i] as number).toBeGreaterThanOrEqual(offsets[i - 1] as number);
    }
    expect(offsets).toEqual([0, 200 / 350, 200 / 350, 300 / 350, 300 / 350, 1, 1]);
  });

  it("reveals the last line only up to its right edge, in step with the pen", () => {
    const frames = revealKeyframes(block, lines);
    const last = lines.at(-1) as DOMRect;
    expect(frames.at(-2)?.offset).toBe(1);
    expect(vertices(frames.at(-2)?.clipPath)[3]).toBe(
      `${last.right - block.left}px ${last.top - block.top}px`,
    );
  });

  it("ends with the whole block open plus the padding", () => {
    const frames = revealKeyframes(block, lines);
    expect(vertices(frames.at(-1)?.clipPath)).toEqual([
      "-24px -24px",
      "224px -24px",
      "224px 104px",
      "224px 104px",
      "224px 104px",
      "-24px 104px",
    ]);
  });

  it("starts closed at the left edge of the first line, markers on the left stay visible", () => {
    const frames = revealKeyframes(block, lines);
    expect(vertices(frames[0]?.clipPath)).toEqual([
      "-24px -24px",
      "224px -24px",
      "224px 0px",
      "0px 0px",
      "0px 20px",
      "-24px 20px",
    ]);
  });

  it("keeps offsets monotone for lines of very different widths", () => {
    const wide = [r(0, 0, 500, 10), r(0, 10, 3, 10), r(0, 20, 120, 10), r(0, 30, 1, 10)];
    const frames = revealKeyframes(r(0, 0, 500, 40), wide);
    const offsets = frames.map((f) => f.offset as number);
    expect(offsets).toHaveLength(9);
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i] as number).toBeGreaterThanOrEqual(offsets[i - 1] as number);
    }
    expect(offsets[0]).toBe(0);
    expect(offsets.at(-1)).toBe(1);
  });

  it("opens the block at once when there are no lines", () => {
    const frames = revealKeyframes(block, []);
    expect(frames).toHaveLength(2);
    expect(frames.map((f) => f.offset)).toEqual([0, 1]);
    expect(vertices(frames[0]?.clipPath)).toEqual(vertices(frames[1]?.clipPath));
    expect(vertices(frames[1]?.clipPath)[2]).toBe("224px 104px");
  });
});

describe("revealSpans", () => {
  it("splits 0..1 by line width, one span per line", () => {
    const lines = [r(0, 0, 200, 20), r(0, 20, 100, 20), r(0, 40, 100, 20)];
    expect(revealSpans(lines)).toEqual([
      { start: 0, end: 0.5 },
      { start: 0.5, end: 0.75 },
      { start: 0.75, end: 1 },
    ]);
  });

  it("splits evenly when all lines are empty", () => {
    expect(revealSpans([r(0, 0, 0, 20), r(0, 20, 0, 20)])).toEqual([
      { start: 0, end: 0.5 },
      { start: 0.5, end: 1 },
    ]);
  });

  it("is the same timeline revealKeyframes uses", () => {
    const lines = [r(0, 0, 200, 20), r(0, 20, 60, 20)];
    const spans = revealSpans(lines);
    const offsets = revealKeyframes(r(0, 0, 200, 40), lines).map((f) => f.offset);
    expect(offsets).toEqual([spans[0]?.start, spans[0]?.end, spans[1]?.start, spans[1]?.end, 1]);
  });
});

describe("revealFront", () => {
  const lines = [r(10, 0, 100, 20), r(10, 20, 300, 20)];
  const block = r(0, 0, 500, 40);

  it("starts at the first line left edge", () => {
    expect(revealFront(block, lines, 0)).toEqual({ x: 10, y: 10, index: 0 });
  });

  it("follows the width proportional timeline of revealKeyframes", () => {
    // first line takes 100 of 400 total width
    expect(revealFront(block, lines, 0.125).x).toBeCloseTo(60);
    expect(revealFront(block, lines, 0.125).y).toBe(10);
    expect(revealFront(block, lines, 0.25 + 0.0001).y).toBe(30);
    expect(revealFront(block, lines, 0.25 + 0.0001).index).toBe(1);
    expect(revealFront(block, lines, 0.625).x).toBeCloseTo(10 + 150);
  });

  it("ends at the right edge of the last line, not at the block edge", () => {
    const end = revealFront(block, lines, 1);
    expect(end.x).toBe(310);
    expect(end.y).toBe(30);
    expect(end.index).toBe(1);
  });

  it("clamps progress and keeps x inside the block", () => {
    expect(revealFront(block, lines, -1).x).toBe(10);
    expect(revealFront(block, lines, 5).x).toBe(310);
    const narrow = r(20, 0, 100, 40);
    expect(revealFront(narrow, lines, 0).x).toBe(20);
    expect(revealFront(narrow, lines, 1).x).toBe(120);
  });
});
