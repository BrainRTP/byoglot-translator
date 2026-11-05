import { BLOCK_SELECTOR, MARK_ATTR } from "./constants";
import { type Block, hasLetters, insideSkipped } from "./extract";
import { encodeNodes } from "./placeholders";

const TEXT_NODE = 3;

// Splitting the boundary text nodes makes the range cover whole nodes, so serialized HTML stays the same.
function splitBoundaries(range: Range) {
  const end = range.endContainer;
  if (end.nodeType === TEXT_NODE && range.endOffset > 0 && range.endOffset < (end as Text).length) {
    (end as Text).splitText(range.endOffset);
  }
  const start = range.startContainer;
  if (
    start.nodeType === TEXT_NODE &&
    range.startOffset > 0 &&
    range.startOffset < (start as Text).length
  ) {
    const offset = range.startOffset;
    const endOffset = range.endOffset;
    const sameNode = range.endContainer === start;
    const tail = (start as Text).splitText(offset);
    // engines differ on whether a live range follows the split, so pin the end explicitly
    if (sameNode) range.setEnd(tail, endOffset - offset);
    range.setStart(tail, 0);
  }
}

export function selectionBlocks(range: Range, nextId: () => string): Block[] {
  if (range.collapsed || !range.startContainer.isConnected) return [];
  splitBoundaries(range);
  const doc = range.startContainer.ownerDocument as Document;
  const root = range.commonAncestorContainer;
  const walker = doc.createTreeWalker(
    root.nodeType === TEXT_NODE ? (root.parentNode as Node) : root,
    4,
  );
  const groups = new Map<Element, Set<Text>>();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    const parent = t.parentElement;
    if (!parent || t.data.trim() === "") continue;
    if (!range.isPointInRange(t, 0) || !range.isPointInRange(t, t.length)) continue;
    if (insideSkipped(parent) || parent.closest(`[${MARK_ATTR}]`)) continue;
    const container = parent.closest(BLOCK_SELECTOR) ?? doc.body;
    const set = groups.get(container) ?? new Set<Text>();
    set.add(t);
    groups.set(container, set);
  }
  const blocks: Block[] = [];
  for (const [element, kept] of groups) {
    const { source, slots, textNodes } = encodeNodes(Array.from(element.childNodes), (t) =>
      kept.has(t),
    );
    if (textNodes.length === 0 || !hasLetters(source)) continue;
    blocks.push({ id: nextId(), element, source, slots, textNodes });
  }
  return blocks;
}
