import { BLOCK_TAGS, MARK_ATTR } from "./constants";
import type { Block, Slot } from "./extract";

export type Token =
  | { type: "text"; value: string }
  | { type: "open"; n: number }
  | { type: "close"; n: number }
  | { type: "self"; n: number };

export type Journal = {
  restoreAll(): void;
  restore(el: Element): void;
  restoreBlock(block: Block): void;
  has(el: Element): boolean;
  hasBlock(block: Block): boolean;
  isOwnValue(node: Text): boolean;
};

type State = {
  apps: Map<Block, Array<() => void>>;
  written: WeakMap<Text, string>;
};

const states = new WeakMap<Journal, State>();

function runUndos(undos: Array<() => void>) {
  for (let i = undos.length - 1; i >= 0; i--) {
    try {
      undos[i]?.();
    } catch {
      // one failing undo must not block the rest
    }
  }
}

export function createJournal(): Journal {
  const state: State = { apps: new Map(), written: new WeakMap() };
  const undoBlock = (block: Block) => {
    const undos = state.apps.get(block);
    state.apps.delete(block);
    if (!undos) return;
    runUndos(undos);
  };
  const journal: Journal = {
    restoreAll() {
      for (const block of [...state.apps.keys()].reverse()) undoBlock(block);
    },
    restore(el) {
      for (const block of [...state.apps.keys()].reverse()) {
        if (block.element === el) undoBlock(block);
      }
    },
    restoreBlock: undoBlock,
    hasBlock(block) {
      return state.apps.has(block);
    },
    has(el) {
      for (const block of state.apps.keys()) if (block.element === el) return true;
      return false;
    },
    isOwnValue(node) {
      return state.written.get(node) === node.nodeValue;
    },
  };
  states.set(journal, state);
  return journal;
}

function stateOf(journal: Journal): State {
  const state = states.get(journal);
  if (!state) throw new Error("unknown journal");
  return state;
}

const TOKEN = /<x(\d+)>|<\/x(\d+)>|<x(\d+)\/>/g;

export function parseTranslated(text: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index > last) tokens.push({ type: "text", value: text.slice(last, m.index) });
    if (m[1] !== undefined) tokens.push({ type: "open", n: Number(m[1]) });
    else if (m[2] !== undefined) tokens.push({ type: "close", n: Number(m[2]) });
    else tokens.push({ type: "self", n: Number(m[3]) });
    last = m.index + m[0].length;
  }
  if (last < text.length) tokens.push({ type: "text", value: text.slice(last) });
  return tokens;
}

function stripTags(text: string): string {
  return parseTranslated(text)
    .map((t) => (t.type === "text" ? t.value : ""))
    .join("");
}

type Frame = { slot: Slot | null; self: boolean; items: Array<string | Frame> };

type Ctx = {
  block: Block;
  doc: Document;
  state: State;
  undos: Array<() => void>;
  own: Map<number, Text[]>;
  kids: Map<number, Slot[]>;
};

const FOLLOWING = 4;
const INLINE_HOSTS: ReadonlySet<string> = new Set(["button", "label", "option"]);

function isFrame(item: string | Frame): item is Frame {
  return typeof item !== "string";
}

function isBlank(s: string): boolean {
  return s.trim() === "";
}

function ownerOf(node: Node, byNode: Map<Element, Slot>): number {
  for (let p = node.parentElement; p; p = p.parentElement) {
    const slot = byNode.get(p);
    if (slot) return slot.n;
  }
  return 0;
}

function parentMap(block: Block): { parents: Map<number, number>; byNode: Map<Element, Slot> } {
  const byNode = new Map<Element, Slot>();
  for (const s of block.slots) if (!s.selfClosing) byNode.set(s.node, s);
  const parents = new Map<number, number>();
  for (const s of block.slots) parents.set(s.n, ownerOf(s.node, byNode));
  return { parents, byNode };
}

function buildTree(block: Block, translated: string, parents: Map<number, number>): Frame | null {
  const bySlot = new Map(block.slots.map((s) => [s.n, s]));
  const root: Frame = { slot: null, self: false, items: [] };
  const stack: Frame[] = [root];
  const seen = new Set<number>();
  const enter = (n: number, self: boolean): Slot | null => {
    const slot = bySlot.get(n);
    const top = stack[stack.length - 1] as Frame;
    if (!slot || slot.selfClosing !== self || seen.has(n)) return null;
    if (parents.get(n) !== (top.slot?.n ?? 0)) return null;
    seen.add(n);
    return slot;
  };
  for (const token of parseTranslated(translated)) {
    const top = stack[stack.length - 1] as Frame;
    if (token.type === "text") {
      top.items.push(token.value);
    } else if (token.type === "close") {
      if (stack.length < 2 || top.slot?.n !== token.n) return null;
      stack.pop();
    } else {
      const self = token.type === "self";
      const slot = enter(token.n, self);
      if (!slot) return null;
      const frame: Frame = { slot, self, items: [] };
      top.items.push(frame);
      if (!self) stack.push(frame);
    }
  }
  if (stack.length !== 1 || seen.size !== block.slots.length) return null;
  return root;
}

function childFrames(frame: Frame): Frame[] {
  return frame.items.filter(isFrame);
}

function segments(frame: Frame): string[] {
  const segs = [""];
  for (const item of frame.items) {
    if (isFrame(item)) segs.push("");
    else segs[segs.length - 1] += item;
  }
  return segs;
}

function isReordered(kids: Frame[]): boolean {
  return kids.some((c, i) => i > 0 && (c.slot?.n ?? 0) < (kids[i - 1]?.slot?.n ?? 0));
}

function ownText(ctx: Ctx, frame: Frame): Text[] {
  return ctx.own.get(frame.slot?.n ?? 0) ?? [];
}

function movables(ctx: Ctx, frame: Frame): Node[] {
  return [...childFrames(frame).map((c) => c.slot?.node as Element), ...ownText(ctx, frame)];
}

function commonParent(nodes: Node[]): Node | null {
  const parent = nodes[0]?.parentNode ?? null;
  return nodes.every((n) => n.parentNode === parent) ? parent : null;
}

function feasible(ctx: Ctx, frame: Frame): boolean {
  const kids = childFrames(frame);
  if (isReordered(kids) && !commonParent(movables(ctx, frame))) return false;
  return kids.every((k) => k.self || feasible(ctx, k));
}

function setText(ctx: Ctx, node: Text, value: string) {
  const old = node.nodeValue;
  if (old !== value) {
    node.nodeValue = value;
    ctx.undos.push(() => {
      node.nodeValue = old;
      ctx.state.written.delete(node);
    });
  }
  ctx.state.written.set(node, value);
}

function createText(ctx: Ctx, value: string): Text {
  const node = ctx.doc.createTextNode(value);
  ctx.state.written.set(node, value);
  ctx.undos.push(() => {
    node.remove();
    ctx.state.written.delete(node);
  });
  return node;
}

function isPlainGap(node: Node | null): node is Text {
  return node?.nodeType === 3 && isBlank((node as Text).data);
}

function place(parent: Node, seq: Node[], before: Node | null) {
  let ref = before;
  for (let i = seq.length - 1; i >= 0; i--) {
    const node = seq[i] as Node;
    if (node.parentNode !== parent || node.nextSibling !== ref) parent.insertBefore(node, ref);
    ref = node;
  }
}

function applyFrame(ctx: Ctx, frame: Frame) {
  const kids = childFrames(frame);
  const segs = segments(frame);
  const own = ownText(ctx, frame);
  if (isReordered(kids)) reorderFrame(ctx, frame, kids, segs, own);
  else inPlaceFrame(ctx, frame, kids, segs, own);
  for (const kid of kids) if (!kid.self) applyFrame(ctx, kid);
}

function inPlaceFrame(ctx: Ctx, frame: Frame, kids: Frame[], segs: string[], own: Text[]) {
  const slots = ctx.kids.get(frame.slot?.n ?? 0) ?? [];
  const gaps: Text[][] = Array.from({ length: slots.length + 1 }, () => []);
  for (const t of own) {
    const g = slots.filter((s) => s.node.compareDocumentPosition(t) & FOLLOWING).length;
    gaps[g]?.push(t);
  }
  segs.forEach((text, i) => {
    const nodes = gaps[i] ?? [];
    if (nodes.length > 0) {
      nodes.forEach((t, j) => {
        setText(ctx, t, j === 0 ? text : "");
      });
      return;
    }
    if (isBlank(text)) return;
    const next = kids[i]?.slot?.node;
    const prev = kids[i - 1]?.slot?.node;
    if (
      next &&
      prev &&
      isPlainGap(next.previousSibling) &&
      next.previousSibling.previousSibling === prev
    ) {
      setText(ctx, next.previousSibling, text);
      return;
    }
    const node = createText(ctx, text);
    if (next) {
      next.parentNode?.insertBefore(node, next);
    } else if (prev) {
      prev.parentNode?.insertBefore(node, prev.nextSibling);
    } else {
      (frame.slot?.node ?? ctx.block.element).append(node);
    }
  });
}

function reorderFrame(ctx: Ctx, frame: Frame, kids: Frame[], segs: string[], own: Text[]) {
  const all = movables(ctx, frame);
  const parent = commonParent(all) as Node;
  const children = Array.from(parent.childNodes);
  const idx = all.map((n) => children.indexOf(n as ChildNode));
  const first = Math.min(...idx);
  const last = Math.max(...idx);
  const snapshot = children.slice(first, last + 1);
  const after = children[last + 1] ?? null;
  const trailing = children.slice(last + 1);
  ctx.undos.push(() => {
    const anchor = trailing.find((n) => n.parentNode === parent) ?? null;
    place(
      parent,
      snapshot.filter((n) => n.parentNode === parent),
      anchor,
    );
  });
  const spaces = snapshot.filter((n): n is Text => isPlainGap(n) && !own.includes(n));
  let ownIdx = 0;
  const seq: Node[] = [];
  segs.forEach((text, i) => {
    if (text !== "") {
      const space = isBlank(text) ? spaces.shift() : undefined;
      const node = space ?? own[ownIdx++] ?? createText(ctx, text);
      setText(ctx, node, text);
      seq.push(node);
    }
    const kid = kids[i];
    if (kid?.slot) seq.push(kid.slot.node);
  });
  for (; ownIdx < own.length; ownIdx++) setText(ctx, own[ownIdx] as Text, "");
  place(parent, seq, after);
}

function newCtx(
  block: Block,
  state: State,
  undos: Array<() => void>,
  byNode: Map<Element, Slot>,
): Ctx {
  const own = new Map<number, Text[]>();
  for (const t of block.textNodes) {
    const n = ownerOf(t, byNode);
    own.set(n, [...(own.get(n) ?? []), t]);
  }
  const kids = new Map<number, Slot[]>();
  for (const s of block.slots) {
    const n = ownerOf(s.node, byNode);
    kids.set(n, [...(kids.get(n) ?? []), s]);
  }
  return { block, doc: block.element.ownerDocument, state, undos, own, kids };
}

function begin(journal: Journal, block: Block) {
  const state = stateOf(journal);
  journal.restoreBlock(block);
  const undos: Array<() => void> = [];
  state.apps.set(block, undos);
  return { state, undos };
}

export function applyAttribute(block: Block, translated: string, journal: Journal): void {
  const attr = block.attr;
  if (!attr) throw new Error("not an attribute block");
  const { undos } = begin(journal, block);
  const el = block.element;
  const original = el.getAttribute(attr);
  const written = stripTags(translated);
  el.setAttribute(attr, written);
  undos.push(() => {
    if (el.getAttribute(attr) !== written) return;
    if (original === null) el.removeAttribute(attr);
    else el.setAttribute(attr, original);
  });
}

function fallbackReplace(ctx: Ctx, translated: string) {
  const text = stripTags(translated);
  ctx.block.textNodes.forEach((t, i) => {
    setText(ctx, t, i === 0 ? text : "");
  });
}

export function applyReplace(block: Block, translated: string, journal: Journal): void {
  const { state, undos } = begin(journal, block);
  const { parents, byNode } = parentMap(block);
  const ctx = newCtx(block, state, undos, byNode);
  const tree = buildTree(block, translated, parents);
  if (tree && feasible(ctx, tree)) {
    try {
      applyFrame(ctx, tree);
      return;
    } catch {
      runUndos(undos);
      undos.length = 0;
    }
  }
  fallbackReplace(ctx, translated);
}

function buildContent(doc: Document, frame: Frame, into: Element | DocumentFragment) {
  for (const item of frame.items) {
    if (!isFrame(item)) {
      into.append(doc.createTextNode(item));
      continue;
    }
    const src = item.slot?.node as Element;
    const clone = src.cloneNode(item.self) as Element;
    clone.removeAttribute("id");
    into.append(clone);
    if (!item.self) buildContent(doc, item, clone);
  }
}

function lastTopLevelNode(ctx: Ctx): Node | null {
  const nodes: Node[] = [...(ctx.own.get(0) ?? []), ...(ctx.kids.get(0) ?? []).map((s) => s.node)];
  let last: Node | null = null;
  for (const n of nodes) {
    if (!last || last.compareDocumentPosition(n) & FOLLOWING) last = n;
  }
  return last;
}

export function applyBilingual(block: Block, translated: string, journal: Journal): Element {
  const { state, undos } = begin(journal, block);
  const { parents, byNode } = parentMap(block);
  const ctx = newCtx(block, state, undos, byNode);
  const doc = ctx.doc;
  const el = doc.createElement("span");
  el.setAttribute(MARK_ATTR, "");
  const tree = buildTree(block, translated, parents);
  if (tree) buildContent(doc, tree, el);
  else el.append(doc.createTextNode(stripTags(translated)));

  const tag = block.element.localName;
  const blockHost = BLOCK_TAGS.has(tag) && !INLINE_HOSTS.has(tag);
  const added: Node[] = [el];
  if (blockHost) el.style.display = "block";
  else added.unshift(doc.createTextNode(" "));

  const last = lastTopLevelNode(ctx);
  if (last?.parentNode) {
    const parent = last.parentNode;
    const ref = last.nextSibling;
    for (const n of added) parent.insertBefore(n, ref);
  } else {
    block.element.append(...added);
  }
  undos.push(() => {
    for (const n of added) n.parentNode?.removeChild(n);
  });
  return el;
}
