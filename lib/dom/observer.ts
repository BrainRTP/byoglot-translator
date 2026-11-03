import { BLOCK_TAGS, MARK_ATTR } from "./constants";

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

export type Changes = { dirty: Set<Element>; added: Set<Element>; removed: Set<Element> };

export function newChanges(): Changes {
  return { dirty: new Set(), added: new Set(), removed: new Set() };
}

export function insideMark(node: Node | null): boolean {
  let cur: Node | null = node;
  while (cur) {
    if (cur.nodeType === ELEMENT_NODE && (cur as Element).hasAttribute(MARK_ATTR)) return true;
    cur = cur.parentNode ?? (cur as ShadowRoot).host ?? null;
  }
  return false;
}

export function containerOf(node: Node): Element | null {
  let cur: Node | null = node.parentNode;
  while (cur) {
    if (cur.nodeType === ELEMENT_NODE && BLOCK_TAGS.has((cur as Element).localName)) {
      return cur as Element;
    }
    const host = (cur as ShadowRoot).host;
    if (host) return host;
    cur = cur.parentNode;
  }
  return null;
}

export function classify(
  records: readonly MutationRecord[],
  isOwn: (node: Text) => boolean,
  into: Changes,
): void {
  const markText = (node: Text) => {
    if (insideMark(node) || isOwn(node) || node.data.trim() === "") return;
    const container = containerOf(node);
    if (container) into.dirty.add(container);
  };
  for (const record of records) {
    if (insideMark(record.target)) continue;
    if (record.type === "characterData") {
      if (record.target.nodeType === TEXT_NODE) markText(record.target as Text);
      continue;
    }
    for (const node of Array.from(record.removedNodes)) {
      if (node.nodeType === ELEMENT_NODE && !insideMark(node)) into.removed.add(node as Element);
    }
    for (const node of Array.from(record.addedNodes)) {
      if (node.nodeType === TEXT_NODE) markText(node as Text);
      else if (node.nodeType === ELEMENT_NODE && !insideMark(node)) into.added.add(node as Element);
    }
  }
}

export function findShadowRoots(root: Node): ShadowRoot[] {
  const found: ShadowRoot[] = [];
  const visit = (scope: ParentNode) => {
    for (const el of Array.from(scope.querySelectorAll("*"))) {
      if (el.shadowRoot) {
        found.push(el.shadowRoot);
        visit(el.shadowRoot);
      }
    }
  };
  const scope = root as ParentNode;
  if (root.nodeType === ELEMENT_NODE) {
    const el = root as Element;
    if (el.shadowRoot) {
      found.push(el.shadowRoot);
      visit(el.shadowRoot);
    }
  }
  if (typeof scope.querySelectorAll === "function") visit(scope);
  return found;
}

export type Watcher = {
  observe(root: Node): void;
  observeShadowRoots(root: Node): void;
  takeRecords(): MutationRecord[];
  disconnect(): void;
};

const OPTIONS: MutationObserverInit = { childList: true, subtree: true, characterData: true };

export function createWatcher(onRecords: (records: MutationRecord[]) => void): Watcher {
  let seen = new WeakSet<Node>();
  const mo = new MutationObserver((records) => onRecords(records));
  const observe = (root: Node) => {
    if (seen.has(root)) return;
    seen.add(root);
    mo.observe(root, OPTIONS);
  };
  return {
    observe,
    observeShadowRoots(root) {
      for (const shadow of findShadowRoots(root)) observe(shadow);
    },
    takeRecords: () => mo.takeRecords(),
    disconnect() {
      mo.disconnect();
      seen = new WeakSet();
    },
  };
}
