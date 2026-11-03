import type { Block } from "./extract";

export type Lane = "main" | "side";

export type RectOf = (el: Element) => {
  left: number;
  right: number;
  top: number;
  width: number;
  height: number;
};

export const MAIN_SHARE = 0.5;
export const MAIN_MIN_WIDTH_SHARE = 0.4;

const MAIN_SELECTOR = 'main, [role="main"]';
const SHADOW_ROOT_NODE = 11;

function largest(els: Element[], rectOf: RectOf): Element | null {
  let best: Element | null = null;
  let bestArea = 0;
  for (const el of els) {
    const r = rectOf(el);
    const area = r.width * r.height;
    if (area > bestArea) {
      best = el;
      bestArea = area;
    }
  }
  return best;
}

function parentOf(el: Element): Element | null {
  return el.parentElement ?? (el.parentNode as ShadowRoot | null)?.host ?? null;
}

function depthOf(el: Element): number {
  let depth = 0;
  for (let p = parentOf(el); p; p = parentOf(p)) depth++;
  return depth;
}

function textShareInside(root: Element, blocks: Block[]): number {
  let inside = 0;
  let total = 0;
  for (const b of blocks) {
    total += b.source.length;
    if (containsComposed(root, b.element)) inside += b.source.length;
  }
  return total === 0 ? 1 : inside / total;
}

function mainByHeuristic(
  doc: Document,
  blocks: Block[],
  rectOf: RectOf,
  viewportWidth: number,
): Element | null {
  if (viewportWidth <= 0) return null;
  const stop = (el: Element) => el === doc.body || el === doc.documentElement;
  const chars = new Map<Element, number>();
  let total = 0;
  for (const b of blocks) {
    total += b.source.length;
    for (let el: Element | null = b.element; el && !stop(el); el = parentOf(el)) {
      chars.set(el, (chars.get(el) ?? 0) + b.source.length);
    }
  }

  const middle = viewportWidth / 2;
  const seen = new Set<Element>();
  let best: Element | null = null;
  let bestDepth = -1;
  let bestChars = 0;
  for (const b of blocks) {
    const r = rectOf(b.element);
    if (r.left > middle || middle > r.right) continue;
    for (let a = parentOf(b.element); a && !stop(a); a = parentOf(a)) {
      if (seen.has(a)) break;
      seen.add(a);
      const c = chars.get(a) ?? 0;
      if (c < MAIN_SHARE * total) continue;
      if (rectOf(a).width < MAIN_MIN_WIDTH_SHARE * viewportWidth) continue;
      const depth = depthOf(a);
      if (depth > bestDepth || (depth === bestDepth && c > bestChars)) {
        best = a;
        bestDepth = depth;
        bestChars = c;
      }
    }
  }
  return best;
}

function refine(root: Element, blocks: Block[], rectOf: RectOf, viewportWidth: number): Element {
  const inside = blocks.filter((b) => containsComposed(root, b.element));
  const deeper = mainByHeuristic(root.ownerDocument, inside, rectOf, viewportWidth);
  return deeper && deeper !== root && containsComposed(root, deeper) ? deeper : root;
}

function accepted(root: Element | null, blocks: Block[]): root is Element {
  return root !== null && textShareInside(root, blocks) >= MAIN_SHARE;
}

export function findMainRoot(
  doc: Document,
  blocks: Block[],
  rectOf: RectOf,
  viewportWidth: number,
): Element | null {
  const semantic = largest(Array.from(doc.querySelectorAll(MAIN_SELECTOR)), rectOf);
  if (accepted(semantic, blocks)) return refine(semantic, blocks, rectOf, viewportWidth);
  const article = largest(Array.from(doc.querySelectorAll("article")), rectOf);
  if (accepted(article, blocks)) return refine(article, blocks, rectOf, viewportWidth);
  return mainByHeuristic(doc, blocks, rectOf, viewportWidth);
}

export function containsComposed(root: Element, el: Element): boolean {
  let node: Node | null = el;
  while (node) {
    if (node === root) return true;
    node =
      node.parentNode ?? (node.nodeType === SHADOW_ROOT_NODE ? (node as ShadowRoot).host : null);
  }
  return false;
}

export function laneOf(mainRoot: Element | null, el: Element): Lane {
  if (!mainRoot) return "main";
  return containsComposed(mainRoot, el) ? "main" : "side";
}

export function orderByPosition<T extends { element: Element }>(
  items: T[],
  rectOf: RectOf,
  rtl = false,
): T[] {
  const keyed = items.map((item) => {
    const r = rectOf(item.element);
    if (r.width === 0 && r.height === 0) return { item, top: Number.POSITIVE_INFINITY, left: 0 };
    return { item, top: Math.round(r.top), left: rtl ? -r.left : r.left };
  });
  keyed.sort((a, b) => (a.top === b.top ? a.left - b.left : a.top < b.top ? -1 : 1));
  return keyed.map((k) => k.item);
}
