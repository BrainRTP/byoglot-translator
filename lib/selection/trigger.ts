import { BLOCK_SELECTOR, MARK_ATTR } from "../dom/constants";
import { t } from "../i18n";
import type { SelectionMode, ThemeChoice } from "../settings/types";
import { applyTheme } from "../ui/theme";
import { type Anchor, type CardDeps, createCard, svgIcon } from "./card";
import { MAX_CONTEXT, MAX_SELECTION } from "./limits";
import { HOST_STYLE, STYLES } from "./styles";

export { MAX_CONTEXT, MAX_EDITOR_TEXT, MAX_SELECTION } from "./limits";

export type SelectionUiDeps = CardDeps & {
  theme?(): Promise<ThemeChoice>;
  selectionMode?(): Promise<SelectionMode>;
};

export type SelectionUi = {
  trigger(): void;
  hasSelection(): boolean;
  insert(): void;
  destroy(): void;
};

const DEBOUNCE_MS = 150;
const TOUCH_DEBOUNCE_MS = 500;
const TOUCH_ICON_SIZE = 44;
const TOUCH_ICON_GAP = 12;
const ICON_SIZE = 24;
const ICON_GAP = 4;
const EDGE = 4;
const EDITABLE_TAGS = new Set(["input", "textarea", "select"]);

type Snapshot = { text: string; context: string; anchor: Anchor; range?: Range };

function isEditable(el: Element): boolean {
  if (EDITABLE_TAGS.has(el.localName)) return true;
  const editable = el.getAttribute("contenteditable");
  return editable !== null && editable.toLowerCase() !== "false";
}

function insideEditable(el: Element | null): boolean {
  for (let cur = el; cur; cur = cur.parentElement) if (isEditable(cur)) return true;
  return false;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function centerContext(block: string, selected: string): string {
  if (block.length <= MAX_CONTEXT) return block;
  const idx = Math.max(0, block.indexOf(collapse(selected)));
  const start = Math.min(
    Math.max(0, idx + Math.floor(selected.length / 2) - Math.floor(MAX_CONTEXT / 2)),
    block.length - MAX_CONTEXT,
  );
  return block.slice(start, start + MAX_CONTEXT);
}

function endAnchor(range: Range): Anchor {
  const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 || r.height > 0);
  return rects.at(-1) ?? range.getBoundingClientRect();
}

function isTextField(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  return el?.localName === "input" || el?.localName === "textarea";
}

function readFieldSelection(field: HTMLInputElement | HTMLTextAreaElement): Snapshot | null {
  let selected: string;
  try {
    const { selectionStart: start, selectionEnd: end } = field;
    if (start === null || end === null) return null;
    selected = field.value.slice(start, end);
  } catch {
    return null;
  }
  const text = selected.trim();
  if (!text || text.length > MAX_SELECTION) return null;
  const { left, right, top, bottom } = field.getBoundingClientRect();
  return {
    text,
    context: centerContext(collapse(field.value), text),
    anchor: { left, right, top, bottom },
  };
}

/** Selections in form fields are read only for explicit commands (hotkey, context menu). */
export function readSelection(doc: Document, explicit = false): Snapshot | null {
  const active = doc.activeElement;
  if (isTextField(active)) {
    if (active.localName === "input" && (active as HTMLInputElement).type === "password")
      return null;
    const field = explicit ? readFieldSelection(active) : null;
    if (field || !explicit) return field;
  }
  const sel = doc.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const text = sel.toString().trim();
  if (!text || text.length > MAX_SELECTION) return null;
  const range = sel.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const container = node.nodeType === 1 ? (node as Element) : node.parentElement;
  if (!container || (!explicit && insideEditable(container))) return null;
  const block = container.closest(BLOCK_SELECTOR) ?? doc.body;
  const { left, right, top, bottom } = endAnchor(range);
  return {
    text,
    context: centerContext(collapse(block?.textContent ?? ""), text),
    anchor: { left, right, top, bottom },
    range: range.cloneRange(),
  };
}

export function mountSelectionUi(doc: Document, deps: SelectionUiDeps): SelectionUi {
  const win = doc.defaultView as Window;
  const touch = win.matchMedia?.("(pointer: coarse)").matches === true;
  const host = doc.createElement("div");
  host.setAttribute(MARK_ATTR, "selection");
  host.setAttribute("style", HOST_STYLE);
  const shadow = host.attachShadow({ mode: "closed" });
  const style = doc.createElement("style");
  style.textContent = STYLES;
  const root = doc.createElement("div");
  root.className = "root";
  shadow.append(style, root);
  doc.documentElement.append(host);

  const card = createCard(root, deps);
  const refreshTheme = () =>
    void deps
      .theme?.()
      .then((choice) => applyTheme(root, choice))
      .catch(() => {});
  let icon: HTMLButtonElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let scrollTimer: ReturnType<typeof setTimeout> | undefined;

  // the snapshot is read before the await: the inserter clears the page selection itself
  async function act(snap: Snapshot, open: (snap: Snapshot) => void) {
    const mode = await deps.selectionMode?.().catch(() => "card");
    if (mode === "inPlace" && snap.range && deps.insert && deps.canInsert?.() !== false) {
      void deps.insert(snap.range);
    } else {
      open(snap);
    }
  }

  function hideIcon() {
    clearTimeout(scrollTimer);
    icon?.remove();
    icon = null;
  }

  function showIcon(snap: Snapshot) {
    hideIcon();
    refreshTheme();
    const { anchor } = snap;
    const vw = win.innerWidth;
    const vh = win.innerHeight;
    const size = touch ? TOUCH_ICON_SIZE : ICON_SIZE;
    let top = anchor.top - ICON_SIZE - ICON_GAP;
    if (touch) {
      top = anchor.bottom + TOUCH_ICON_GAP;
      if (top + size > vh - EDGE) {
        top = Math.max(EDGE, anchor.top - size - TOUCH_ICON_GAP);
      }
    } else if (top < EDGE) top = anchor.bottom + ICON_GAP;
    const left = Math.min(Math.max(anchor.right - size, EDGE), Math.max(EDGE, vw - size - EDGE));
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.className = touch ? "icon touch" : "icon";
    btn.setAttribute("aria-label", t("selection.translate"));
    btn.style.left = `${left}px`;
    btn.style.top = `${Math.min(top, Math.max(EDGE, vh - size - EDGE))}px`;
    btn.append(
      svgIcon(doc, 14, [
        "m5 8 6 6",
        "m4 14 6-6 2-3",
        "M2 5h12",
        "M7 2h1",
        "m22 22-5-10-5 10",
        "M14 18h6",
      ]),
    );
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", () => {
      hideIcon();
      void act(snap, card.open);
    });
    root.append(btn);
    icon = btn;
  }

  function inHost(node: Node | null) {
    return node !== null && (node === host || node.getRootNode() === shadow);
  }

  function selectionInHost() {
    const sel = doc.getSelection();
    return !!sel && (inHost(sel.anchorNode) || inHost(sel.focusNode));
  }

  function check(fromMouse: boolean, fromHost = false) {
    if (card.isOpen()) {
      if (!fromMouse || selectionInHost()) return;
      const picked = readSelection(doc);
      if (!picked || picked.text === card.lastText()) return;
      if (card.mode() === "pinned") {
        card.add(picked);
      } else {
        // the safe zone keeps the card on mousedown, a new selection still replaces it
        card.close();
        showIcon(picked);
      }
      return;
    }
    // a mouseup on the window (the cross) must not bring the icon back for the old page selection
    if (fromHost) return;
    const snap = readSelection(doc);
    if (snap) showIcon(snap);
    else hideIcon();
  }

  function schedule(fromMouse: boolean, fromHost = false) {
    clearTimeout(timer);
    timer = setTimeout(() => check(fromMouse, fromHost), DEBOUNCE_MS);
  }

  const onMouseUp = (e: Event) => schedule(true, e.target === host);
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.shiftKey || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a")) schedule(false);
  };
  const onMouseDown = (e: Event) => {
    if (e.target === host) return;
    clearTimeout(timer);
    hideIcon();
    if (card.mode() === "pinned") return;
    if (card.inSafeZone((e as MouseEvent).clientX, (e as MouseEvent).clientY)) return;
    card.close();
  };
  const onSelectionChange = () => {
    const sel = doc.getSelection();
    if (!sel || sel.isCollapsed) hideIcon();
    if (touch) {
      clearTimeout(timer);
      timer = setTimeout(() => check(true), TOUCH_DEBOUNCE_MS);
    }
  };
  const onScroll = () => {
    if (!touch) {
      hideIcon();
      return;
    }
    if (!icon) return;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      const snap = readSelection(doc);
      if (icon && snap) showIcon(snap);
      else hideIcon();
    }, DEBOUNCE_MS);
  };

  doc.addEventListener("mouseup", onMouseUp, true);
  doc.addEventListener("keyup", onKeyUp, true);
  doc.addEventListener("mousedown", onMouseDown, true);
  doc.addEventListener("selectionchange", onSelectionChange);
  win.addEventListener("scroll", onScroll, { capture: true, passive: true });

  return {
    trigger() {
      clearTimeout(timer);
      const snap = readSelection(doc, true);
      if (!snap) return;
      hideIcon();
      refreshTheme();
      void act(snap, card.add);
    },
    hasSelection: () => readSelection(doc, true) !== null,
    insert() {
      clearTimeout(timer);
      const range = readSelection(doc, true)?.range;
      if (!range || deps.canInsert?.() === false) return;
      hideIcon();
      void deps.insert?.(range);
    },
    destroy() {
      clearTimeout(timer);
      hideIcon();
      doc.removeEventListener("mouseup", onMouseUp, true);
      doc.removeEventListener("keyup", onKeyUp, true);
      doc.removeEventListener("mousedown", onMouseDown, true);
      doc.removeEventListener("selectionchange", onSelectionChange);
      win.removeEventListener("scroll", onScroll, { capture: true });
      card.close();
      host.remove();
    },
  };
}
