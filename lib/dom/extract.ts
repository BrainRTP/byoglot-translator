import {
  BLOCK_ID_ATTR,
  BLOCK_SELECTOR,
  BLOCK_TAGS,
  isPreservedInline,
  isSkippable,
} from "./constants";
import { encodeNodes, type Slot } from "./placeholders";

export { isSkippable } from "./constants";
export type { Slot } from "./placeholders";

export type Block = {
  id: string;
  element: Element;
  source: string;
  slots: Slot[];
  textNodes: Text[];
  attr?: AttrName;
};

export type AttrName = "title" | "alt" | "placeholder";

export type ExtractOpts = {
  isTranslated(el: Element): boolean;
  nextId(): string;
};

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const DOCUMENT_NODE = 9;
const FRAGMENT_NODE = 11;

export function hasLetters(value: string): boolean {
  const text = value
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/www\.\S+/gi, " ")
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, " ");
  return /\p{L}/u.test(text);
}

export function extractBlocks(root: Node, opts: ExtractOpts): Block[] {
  const blocks: Block[] = [];

  const hasText = (textNodes: Text[]) => hasLetters(textNodes.map((t) => t.data).join(" "));

  const emitRun = (container: Element, run: Node[], own: Block[]) => {
    if (opts.isTranslated(container)) return;
    const { source, slots, textNodes } = encodeNodes(run);
    if (textNodes.length === 0 || !hasText(textNodes)) return;
    const block: Block = { id: opts.nextId(), element: container, source, slots, textNodes };
    own.push(block);
    blocks.push(block);
  };

  const walkScope = (container: Element, children: NodeListOf<ChildNode>, markId: boolean) => {
    const own: Block[] = [];
    let run: Node[] = [];
    const flush = () => {
      if (run.length > 0) emitRun(container, run, own);
      run = [];
    };
    const walk = (list: NodeListOf<ChildNode>) => {
      for (const node of Array.from(list)) {
        if (node.nodeType === TEXT_NODE) {
          run.push(node);
          continue;
        }
        if (node.nodeType !== ELEMENT_NODE) continue;
        const el = node as Element;
        const tag = el.localName;
        if (isSkippable(el)) {
          if (tag === "pre") flush();
          else if (isPreservedInline(el)) run.push(el);
          continue;
        }
        if (BLOCK_TAGS.has(tag)) {
          flush();
          visitBlock(el);
          continue;
        }
        if (el.shadowRoot) walkScope(el, el.shadowRoot.childNodes, false);
        if (el.querySelector(BLOCK_SELECTOR)) walk(el.childNodes);
        else run.push(el);
      }
    };
    walk(children);
    flush();
    if (markId && own.length === 1 && own[0]) container.setAttribute(BLOCK_ID_ATTR, own[0].id);
  };

  const visitBlock = (el: Element) => {
    walkScope(el, el.childNodes, true);
    if (el.shadowRoot) walkScope(el, el.shadowRoot.childNodes, false);
  };

  let start: Element | null = null;
  if (root.nodeType === DOCUMENT_NODE) {
    const doc = root as Document;
    start = doc.body ?? doc.documentElement;
  } else if (root.nodeType === ELEMENT_NODE) {
    start = root as Element;
  } else if (root.nodeType === FRAGMENT_NODE && (root as ShadowRoot).host) {
    const host = (root as ShadowRoot).host;
    if (insideSkipped(host)) return blocks;
    walkScope(host, root.childNodes, false);
    return blocks;
  }
  if (!start || insideSkipped(start)) return blocks;
  visitBlock(start);
  return blocks;
}

export function insideSkipped(el: Element): boolean {
  let cur: Node | null = el;
  while (cur) {
    if (cur.nodeType === ELEMENT_NODE && isSkippable(cur as Element)) return true;
    cur = cur.parentNode ?? (cur as ShadowRoot).host ?? null;
  }
  return false;
}
