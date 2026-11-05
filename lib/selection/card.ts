import type { ConnectionKind } from "../connections/types";
import { resolveLang, t } from "../i18n";
import type { BackendErrorKind, ModelRef } from "../opencode/types";
import type { Template } from "../settings/types";
import { describeError } from "../ui/errors";
import type { InsertOutcome } from "./insert";
import { renderSafeMarkdown } from "./markdown";
import { attachWindow, type WindowShell } from "./window";

export type SelectionTranslation =
  | { text: string; sourceLang?: string; targetLang?: string; model?: ModelRef }
  | { error: BackendErrorKind; retryAfterMs?: number; backend?: ConnectionKind; source?: string };

export type CardDeps = {
  translate(
    text: string,
    context: string,
    templateId: string | undefined,
    window: CardMode,
  ): Promise<SelectionTranslation>;
  listTemplates(): Promise<Template[]>;
  currentTemplateId?(): Promise<string | undefined>;
  openSettings?(): void;
  cancel?(): void;
  insert?(range: Range): Promise<InsertOutcome>;
  canInsert?(): boolean;
};

export type Anchor = { left: number; right: number; top: number; bottom: number };

export type CardRequest = { text: string; context: string; anchor: Anchor; range?: Range };

type State =
  | { kind: "loading" }
  | { kind: "result"; text: string; langs: string; model: string }
  | {
      kind: "error";
      error: BackendErrorKind;
      retryAfterMs?: number;
      backend?: ConnectionKind;
      source?: string;
    };

export type CardMode = "oneshot" | "pinned";

type Entry = {
  req: CardRequest;
  el: HTMLElement;
  seq: number;
  pending: boolean;
  state: State;
  copyTimer?: ReturnType<typeof setTimeout>;
};

const PIN_ICON = [
  "M12 17v5",
  "M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z",
];

const INSERT_ICON = [
  "M14 4a2 2 0 0 1 2-2",
  "M16 10a2 2 0 0 1-2-2",
  "M20 2a2 2 0 0 1 2 2",
  "M22 8a2 2 0 0 1-2 2",
  "m3 7 3 3 3-3",
  "M6 10V5a3 3 0 0 1 3-3h1",
  "M4 14h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2z",
];

const WIDTH = 380;
const PINNED_MIN_HEIGHT = 420;
const MARGIN = 8;
const COPIED_MS = 1500;
const SVG_NS = "http://www.w3.org/2000/svg";

export function svgIcon(doc: Document, size: number, paths: string[], width = 2): SVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", String(width));
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const path = doc.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}

function h<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = doc.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

function errorView(
  kind: BackendErrorKind,
  retryAfterMs?: number,
  backend?: ConnectionKind,
  source?: string,
) {
  return describeError(
    kind === "aborted" ? "bad_response" : kind,
    "card",
    retryAfterMs,
    Date.now(),
    backend,
    source,
  );
}

function languageName(code: string): string {
  if (code === "auto") return t("selection.auto");
  try {
    return new Intl.DisplayNames([resolveLang()], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function languagePair(res: { sourceLang?: string; targetLang?: string }): string {
  if (!res.sourceLang || !res.targetLang) return "";
  return `${languageName(res.sourceLang)} \u2192 ${languageName(res.targetLang)}`;
}

function modelLine(model: ModelRef | undefined): string {
  if (!model) return "";
  return model.variant ? `${model.id} \u00b7 ${model.variant}` : model.id;
}

export function templateLabel(tpl: Template): string {
  return tpl.builtin ? t("template.builtin") : tpl.name;
}

export function createCard(root: HTMLElement, deps: CardDeps) {
  const doc = root.ownerDocument;
  const win = doc.defaultView as Window;
  let card: HTMLElement | null = null;
  let feed: HTMLElement | null = null;
  let select: HTMLSelectElement | null = null;
  let lang: HTMLElement | null = null;
  let pin: HTMLButtonElement | null = null;
  let insertBtn: HTMLButtonElement | null = null;
  let insertTimer: ReturnType<typeof setTimeout> | undefined;
  let shell: WindowShell | null = null;
  let entries: Entry[] = [];
  let anchor: Anchor | null = null;
  let placed: { left: number; top: number } | null = null;
  let moved = false;
  let mode: CardMode = "oneshot";
  let initialTemplateId: string | undefined;

  function isFree() {
    return mode === "pinned" || shell?.wasResized() === true;
  }

  // anchor-based placement and content-height fit for a card the user has not resized
  function layout() {
    if (!card || !shell || !anchor || isFree()) return;
    const vw = win.innerWidth;
    const vh = win.innerHeight;
    const width = Math.min(WIDTH, Math.max(0, vw - 2 * MARGIN));
    card.style.width = `${width}px`;
    card.style.height = "";
    const height = card.offsetHeight;
    const cur = shell.rect();
    if (placed && (cur.left !== placed.left || cur.top !== placed.top)) moved = true;
    let left = cur.left;
    let top = cur.top;
    if (!moved) {
      top = anchor.bottom + MARGIN;
      if (top + height > vh - MARGIN && anchor.top - MARGIN - height >= MARGIN) {
        top = anchor.top - MARGIN - height;
      }
      left = clamp(anchor.left, MARGIN, Math.max(MARGIN, vw - width - MARGIN));
      top = clamp(top, MARGIN, Math.max(MARGIN, vh - height - MARGIN));
    }
    shell.setRect({ left, top, width, height });
    const { left: l, top: t } = shell.rect();
    placed = { left: l, top: t };
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape" && mode === "oneshot") close();
  }

  function buttons(...btns: HTMLElement[]) {
    const bar = h(doc, "div", "bar");
    const group = h(doc, "div", "btns");
    group.append(...btns);
    bar.append(group);
    if (mode === "oneshot") bar.append(h(doc, "kbd", undefined, "Esc"));
    return bar;
  }

  function button(label: string, onClick: () => void) {
    const b = h(doc, "button", "btn sm", label);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }

  function flash(entry: Entry, btn: HTMLButtonElement, label: string) {
    btn.textContent = label;
    clearTimeout(entry.copyTimer);
    entry.copyTimer = setTimeout(() => {
      btn.textContent = t("selection.copy");
    }, COPIED_MS);
  }

  function copy(entry: Entry, btn: HTMLButtonElement, text: string) {
    const failed = () => flash(entry, btn, t("selection.copyFailed"));
    const written = navigator.clipboard?.writeText(text);
    if (!written) failed();
    else written.then(() => flash(entry, btn, t("selection.copied")), failed);
  }

  function render(entry: Entry, state: State) {
    if (!card) return;
    entry.state = state;
    const el = entry.el;
    el.replaceChildren();
    if (mode === "pinned") {
      const src = h(doc, "div", "src", entry.req.text);
      src.setAttribute("role", "group");
      src.setAttribute("aria-label", t("selection.source"));
      el.append(src);
    }
    if (state.kind === "loading") {
      const row = h(doc, "div", "loading");
      row.append(h(doc, "span", "spin"), h(doc, "span", undefined, t("selection.loading")));
      el.append(row);
    } else if (state.kind === "result") {
      const text = state.text;
      // oneshot shows the language pair in the header, pinned in each entry
      if (mode === "pinned") {
        if (state.langs) el.append(h(doc, "div", "lang", state.langs));
      } else if (lang) {
        lang.textContent = state.langs;
      }
      const scroll = h(doc, "div", "scroll md");
      scroll.tabIndex = 0;
      scroll.setAttribute("role", "region");
      scroll.setAttribute("aria-label", t("selection.result"));
      scroll.append(renderSafeMarkdown(text, doc));
      const copyBtn = button(t("selection.copy"), () => copy(entry, copyBtn, text));
      const foot = h(doc, "div", "foot");
      foot.append(
        buttons(
          copyBtn,
          button(t("selection.retranslate"), () => run(entry)),
        ),
      );
      if (state.model) foot.append(h(doc, "div", "mono muted", state.model));
      el.append(scroll, foot);
    } else {
      const view = errorView(state.error, state.retryAfterMs, state.backend, state.source);
      const box = h(doc, "div", "err");
      box.setAttribute("role", "alert");
      box.append(h(doc, "div", `et ${view.tone}`, view.title), h(doc, "div", undefined, view.body));
      if (view.hint) box.append(h(doc, "div", "mono cmd", view.hint));
      const settings = view.action === "chooseModel" ? deps.openSettings : undefined;
      box.append(
        buttons(
          settings
            ? button(t("selection.openSettings"), () => settings())
            : button(t("selection.retry"), () => run(entry)),
        ),
      );
      el.append(box);
    }
    layout();
  }

  function run(entry: Entry) {
    // pinned requests are independent; deps.cancel would stop all of them
    if (mode === "oneshot" && entry.pending) deps.cancel?.();
    const { text, context } = entry.req;
    const mine = ++entry.seq;
    const templateId =
      select && !select.hidden && select.value !== initialTemplateId ? select.value : undefined;
    render(entry, { kind: "loading" });
    entry.pending = true;
    const response = deps.translate(text, context, templateId, mode);
    response.then(
      (res) => {
        if (mine !== entry.seq) return;
        entry.pending = false;
        render(
          entry,
          "text" in res
            ? {
                kind: "result",
                text: res.text,
                langs: languagePair(res),
                model: modelLine(res.model),
              }
            : { kind: "error", ...res },
        );
      },
      () => {
        if (mine !== entry.seq) return;
        entry.pending = false;
        render(entry, { kind: "error", error: "provider_error" });
      },
    );
  }

  function fillTemplates(list: Template[], current: string | undefined) {
    if (!select || list.length === 0) return;
    for (const tpl of list) {
      const opt = h(doc, "option", undefined, templateLabel(tpl));
      opt.value = tpl.id;
      select.append(opt);
    }
    const selected =
      list.find((tpl) => tpl.id === current) ?? list.find((tpl) => tpl.builtin) ?? list[0];
    if (!selected) return;
    select.value = selected.id;
    initialTemplateId = selected.id;
    select.hidden = false;
  }

  function retire(entry: Entry) {
    entry.pending = false;
    entry.seq++;
    clearTimeout(entry.copyTimer);
  }

  function newEntry(req: CardRequest): Entry {
    return {
      req,
      el: h(doc, "div", "entry"),
      seq: 0,
      pending: false,
      state: { kind: "loading" },
    };
  }

  function syncInsert() {
    if (!insertBtn) return;
    insertBtn.hidden = !entries[0]?.req.range || !deps.insert || deps.canInsert?.() === false;
  }

  function flashInsert(title: string) {
    if (!insertBtn) return;
    insertBtn.title = title;
    clearTimeout(insertTimer);
    insertTimer = setTimeout(() => {
      if (insertBtn) insertBtn.title = t("selection.insert");
    }, COPIED_MS);
  }

  function insertTop() {
    const range = entries[0]?.req.range;
    const btn = insertBtn;
    if (!range || !btn || !deps.insert || btn.disabled) return;
    btn.disabled = true;
    const settle = (outcome: InsertOutcome) => {
      btn.disabled = false;
      if (outcome === "empty") flashInsert(t("selection.insertEmpty"));
      else if (outcome !== "done") {
        flashInsert(
          errorView(outcome.error, outcome.retryAfterMs, outcome.backend, outcome.source).title,
        );
      }
    };
    deps.insert(range).then(settle, () => settle({ error: "provider_error" }));
  }

  function syncChrome() {
    if (!card || !pin) return;
    const pinned = mode === "pinned";
    card.classList.toggle("pinned", pinned);
    card.classList.toggle("free", isFree());
    syncInsert();
    pin.setAttribute("aria-pressed", String(pinned));
    const label = t(pinned ? "selection.unpin" : "selection.pin");
    pin.setAttribute("aria-label", label);
    pin.title = label;
  }

  function setMode(next: CardMode) {
    if (!card || next === mode) return;
    mode = next;
    let rerun: Entry | undefined;
    if (next === "oneshot") {
      const dropped = entries.slice(1);
      const orphaned = dropped.some((e) => e.pending);
      for (const entry of dropped) {
        retire(entry);
        entry.el.remove();
      }
      entries = entries.slice(0, 1);
      // cancel stops every request of the tab, so the kept entry is sent again
      if (orphaned) {
        deps.cancel?.();
        const top = entries[0];
        if (top?.pending) {
          top.pending = false;
          rerun = top;
        }
      }
    } else {
      if (lang) lang.textContent = "";
      if (shell && !shell.wasResized()) {
        const cur = shell.rect();
        shell.setRect({ ...cur, height: Math.max(cur.height, PINNED_MIN_HEIGHT) });
      }
    }
    syncChrome();
    for (const entry of entries) render(entry, entry.state);
    if (rerun) run(rerun);
  }

  function open(req: CardRequest) {
    close();
    anchor = req.anchor;
    initialTemplateId = undefined;
    card = h(doc, "div", "card");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", t("selection.dialog"));

    const head = h(doc, "div", "head");
    select = h(doc, "select", "tsel");
    select.setAttribute("aria-label", t("selection.template"));
    select.title = t("selection.templateHint");
    select.hidden = true;
    select.addEventListener("change", () => {
      const top = entries[0];
      if (mode === "oneshot" && top) run(top);
    });
    pin = h(doc, "button", "btn ico flat pin");
    pin.type = "button";
    pin.append(svgIcon(doc, 14, PIN_ICON));
    pin.addEventListener("click", () => setMode(mode === "pinned" ? "oneshot" : "pinned"));
    const closeBtn = h(doc, "button", "btn ico flat");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", t("selection.close"));
    closeBtn.append(svgIcon(doc, 14, ["M6 6l12 12M18 6L6 18"]));
    closeBtn.addEventListener("click", close);
    lang = h(doc, "span", "lang");
    insertBtn = h(doc, "button", "btn ico flat");
    insertBtn.type = "button";
    insertBtn.hidden = true;
    insertBtn.setAttribute("aria-label", t("selection.insert"));
    insertBtn.title = t("selection.insert");
    insertBtn.append(svgIcon(doc, 14, INSERT_ICON));
    insertBtn.addEventListener("click", insertTop);
    head.append(select, lang, insertBtn, pin, closeBtn);

    feed = h(doc, "div", "feed");
    card.append(head, feed);
    root.append(card);
    shell = attachWindow(card, head, () => syncChrome());
    syncChrome();
    doc.addEventListener("keydown", onKeyDown, true);

    const mine = card;
    void Promise.all([
      deps.listTemplates().catch((): Template[] => []),
      (deps.currentTemplateId?.() ?? Promise.resolve(undefined)).catch(() => undefined),
    ]).then(([list, current]) => {
      if (card === mine) fillTemplates(list, current);
    });
    push(req);
  }

  function push(req: CardRequest) {
    if (!feed) return;
    const entry = newEntry(req);
    entries.unshift(entry);
    syncInsert();
    feed.prepend(entry.el);
    if (mode === "pinned") feed.scrollTop = 0;
    run(entry);
  }

  function add(req: CardRequest) {
    if (card && mode === "pinned") push(req);
    else open(req);
  }

  function close() {
    // retired requests stay registered in the content script, so cancel even if none is pending
    if (card) deps.cancel?.();
    for (const entry of entries) retire(entry);
    clearTimeout(insertTimer);
    doc.removeEventListener("keydown", onKeyDown, true);
    shell?.destroy();
    card?.remove();
    card = feed = select = lang = pin = insertBtn = shell = null;
    entries = [];
    anchor = placed = null;
    moved = false;
    mode = "oneshot";
  }

  return {
    open,
    add,
    close,
    isOpen: () => card !== null,
    mode: () => mode,
    setMode,
    inSafeZone: (x: number, y: number) => shell?.inSafeZone(x, y) ?? false,
    lastText: () => entries[0]?.req.text,
  };
}
