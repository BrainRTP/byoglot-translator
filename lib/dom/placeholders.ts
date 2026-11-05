import { BLOCK_TAGS, isPreservedInline, isSkippable, VOID_INLINE_TAGS } from "./constants";

export type Slot = { n: number; node: Element; selfClosing: boolean };

export type Encoded = { source: string; slots: Slot[]; textNodes: Text[] };

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;
const GAP = "\uE000";

function trimGaps(s: string): string {
  return s.replace(/^\uE000+|\uE000+$/g, "");
}

export function encodeBlock(el: Element): Encoded {
  return encodeNodes(Array.from(el.childNodes));
}

export function encodeNodes(nodes: Node[], keep?: (t: Text) => boolean): Encoded {
  const slots: Slot[] = [];
  const textNodes: Text[] = [];
  const source = trimGaps(encode(nodes, slots, textNodes, keep)).replaceAll(GAP, " ");
  return { source: source.replace(/ {2,}/g, " ").trim(), slots, textNodes };
}

function encode(
  nodes: Node[],
  slots: Slot[],
  textNodes: Text[],
  keep?: (t: Text) => boolean,
): string {
  let out = "";
  for (const node of nodes) {
    if (node.nodeType === TEXT_NODE) {
      const text = node as Text;
      if (text.data.trim() === "") {
        out += GAP;
        continue;
      }
      if (keep && !keep(text)) continue;
      textNodes.push(text);
      out += text.data.replace(/[ \t\r\n\f]+/g, " ");
      continue;
    }
    if (node.nodeType !== ELEMENT_NODE) continue;
    const el = node as Element;
    const tag = el.localName;
    if (isSkippable(el)) {
      if (isPreservedInline(el)) out += selfClosing(el, slots);
      continue;
    }
    if (BLOCK_TAGS.has(tag)) continue;
    if (VOID_INLINE_TAGS.has(tag)) {
      out += selfClosing(el, slots);
      continue;
    }
    const slot: Slot = { n: slots.length + 1, node: el, selfClosing: false };
    slots.push(slot);
    const inner = trimGaps(encode(Array.from(el.childNodes), slots, textNodes, keep));
    if (inner === "") {
      slots.pop();
      continue;
    }
    out += `<x${slot.n}>${inner}</x${slot.n}>`;
  }
  return out;
}

function selfClosing(el: Element, slots: Slot[]): string {
  const n = slots.length + 1;
  slots.push({ n, node: el, selfClosing: true });
  return `<x${n}/>`;
}
