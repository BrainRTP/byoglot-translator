import { isSkippable } from "./constants";
import { type AttrName, type Block, hasLetters, insideSkipped } from "./extract";

export type { AttrName } from "./extract";

export type AttrOpts = {
  isDone(el: Element, attr: AttrName): boolean;
  nextId(): string;
};

const TEXT_INPUTS: ReadonlySet<string> = new Set([
  "text",
  "search",
  "email",
  "url",
  "tel",
  "password",
  "number",
]);

const ATTRS: AttrName[] = ["title", "alt", "placeholder"];
const ELEMENT_NODE = 1;
const DOCUMENT_NODE = 9;
const FRAGMENT_NODE = 11;

function isField(el: Element): boolean {
  return el.localName === "input" || el.localName === "textarea";
}

function inputType(el: Element): string {
  return (el.getAttribute("type") || "text").toLowerCase();
}

function allows(el: Element, attr: AttrName): boolean {
  const tag = el.localName;
  if (attr === "title") return true;
  if (attr === "alt") {
    return tag === "img" || tag === "area" || (tag === "input" && inputType(el) === "image");
  }
  return tag === "textarea" || (tag === "input" && TEXT_INPUTS.has(inputType(el)));
}

function parentHost(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  return (el.parentNode as ShadowRoot | null)?.host ?? null;
}

export function extractAttributes(root: Node, opts: AttrOpts): Block[] {
  const blocks: Block[] = [];

  const visit = (el: Element) => {
    if (isSkippable(el, isField(el))) return;
    for (const attr of ATTRS) {
      const value = el.getAttribute(attr);
      if (value === null || !allows(el, attr) || !hasLetters(value)) continue;
      if (opts.isDone(el, attr)) continue;
      blocks.push({
        id: opts.nextId(),
        element: el,
        source: value,
        slots: [],
        textNodes: [],
        attr,
      });
    }
    if (el.shadowRoot) for (const c of Array.from(el.shadowRoot.children)) visit(c);
    for (const c of Array.from(el.children)) visit(c);
  };

  if (root.nodeType === DOCUMENT_NODE) {
    const doc = root as Document;
    const start = doc.body ?? doc.documentElement;
    if (start) visit(start);
  } else if (root.nodeType === ELEMENT_NODE) {
    const host = parentHost(root as Element);
    if (!host || !insideSkipped(host)) visit(root as Element);
  } else if (root.nodeType === FRAGMENT_NODE && (root as ShadowRoot).host) {
    const host = (root as ShadowRoot).host;
    if (!insideSkipped(host)) for (const c of Array.from((root as ShadowRoot).children)) visit(c);
  }
  return blocks;
}
