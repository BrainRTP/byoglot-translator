import { px, textNodes } from "./util";

const SAME_LINE = 0.5;

function sameLine(a: DOMRect, b: DOMRect): boolean {
  const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return overlap >= Math.min(a.height, b.height) * SAME_LINE;
}

function union(a: DOMRect, b: DOMRect): DOMRect {
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  return new DOMRect(
    left,
    top,
    Math.max(a.right, b.right) - left,
    Math.max(a.bottom, b.bottom) - top,
  );
}

export function lineBoxes(root: Element): DOMRect[] {
  const doc = root.ownerDocument;
  const rects: DOMRect[] = [];
  for (const node of textNodes(root)) {
    if (!node.data.trim()) continue;
    const range = doc.createRange();
    range.selectNodeContents(node);
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width > 0 && rect.height > 0) rects.push(rect);
    }
  }
  rects.sort((a, b) => a.top - b.top || a.left - b.left);
  const lines: DOMRect[] = [];
  for (const rect of rects) {
    const last = lines[lines.length - 1];
    if (last && sameLine(last, rect)) lines[lines.length - 1] = union(last, rect);
    else lines.push(rect);
  }
  return lines;
}

// the clip reaches this far past the block so list markers, overhang and text-shadow stay visible
const PAD = 24;

function polygon(w: number, x: number, yTop: number, yBottom: number): string {
  const pts = [
    [-PAD, -PAD],
    [w + PAD, -PAD],
    [w + PAD, yTop],
    [x, yTop],
    [x, yBottom],
    [-PAD, yBottom],
  ];
  return `polygon(${pts.map(([a, b]) => `${px(a as number)}px ${px(b as number)}px`).join(", ")})`;
}

// share of the reveal timeline (0..1) each line takes, proportional to its width
export function revealSpans(lines: DOMRect[]): Array<{ start: number; end: number }> {
  const total = lines.reduce((sum, l) => sum + Math.max(l.width, 0), 0);
  let acc = 0;
  return lines.map((line, i) => {
    const start = total > 0 ? acc / total : i / lines.length;
    acc += Math.max(line.width, 0);
    const end = total > 0 ? acc / total : (i + 1) / lines.length;
    return { start, end };
  });
}

export function revealKeyframes(blockRect: DOMRect, lines: DOMRect[]): Keyframe[] {
  const w = blockRect.width;
  const h = blockRect.height;
  const open = polygon(w, w + PAD, h + PAD, h + PAD);
  if (lines.length === 0) {
    return [
      { clipPath: open, offset: 0 },
      { clipPath: open, offset: 1 },
    ];
  }
  const clampX = (v: number) => Math.min(Math.max(v, 0), w);
  const clampY = (v: number) => Math.min(Math.max(v, 0), h);
  const spans = revealSpans(lines);
  const frames: Keyframe[] = [];
  lines.forEach((line, i) => {
    const yTop = clampY(line.top - blockRect.top);
    const yBottom = clampY(line.bottom - blockRect.top);
    const { start: startAt, end: endAt } = spans[i] as { start: number; end: number };
    frames.push({
      clipPath: polygon(w, clampX(line.left - blockRect.left), yTop, yBottom),
      offset: startAt,
    });
    frames.push({
      clipPath: polygon(w, clampX(line.right - blockRect.left), yTop, yBottom),
      offset: endAt,
    });
  });
  // a separate frame at 1: interpolating the last line into `open` ran ahead of the pen
  frames.push({ clipPath: open, offset: 1 });
  return frames;
}

export type Front = { x: number; y: number; index: number };

// where the reveal front sits at progress p (0..1): x on the current line, y is its middle
export function revealFront(blockRect: DOMRect, lines: DOMRect[], p: number): Front {
  const first = lines[0];
  if (!first) return { x: 0, y: 0, index: -1 };
  const q = Math.min(Math.max(p, 0), 1);
  const spans = revealSpans(lines);
  const clampX = (v: number) => Math.min(Math.max(v, blockRect.left), blockRect.right);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as DOMRect;
    const { start, end } = spans[i] as { start: number; end: number };
    if (q <= end || i === lines.length - 1) {
      const t = end > start ? Math.min(Math.max((q - start) / (end - start), 0), 1) : 1;
      return {
        x: clampX(line.left + (line.right - line.left) * t),
        y: line.top + line.height / 2,
        index: i,
      };
    }
  }
  return { x: clampX(first.left), y: first.top + first.height / 2, index: 0 };
}
