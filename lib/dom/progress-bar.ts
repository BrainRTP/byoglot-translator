import type { PageState } from "../messaging/protocol";
import { DARK, LIGHT } from "../selection/styles";
import { MARK_ATTR } from "./constants";
import { type BarView, nextBarView } from "./progress";

const FADE_MS = 400;

const HOST_STYLE = [
  "all: initial",
  "position: fixed",
  "top: 0",
  "left: 0",
  "width: 100%",
  "height: 3px",
  "display: block",
  "pointer-events: none",
  "z-index: 2147483647",
]
  .map((d) => `${d} !important`)
  .join("; ");

const STYLE = `
:host{${LIGHT}}
@media (prefers-color-scheme: dark){:host{${DARK}}}
.bar{height:100%;width:0;background:var(--ac);transition:width 200ms linear}
.bar.paused{background:var(--wn)}
.bar.done{opacity:0;transition:width 200ms linear,opacity ${FADE_MS}ms linear}
@media (prefers-reduced-motion: reduce){.bar,.bar.done{transition:none}}
`;

export function createProgressBar(doc: Document): {
  update(state: PageState): void;
  destroy(): void;
} {
  const win = doc.defaultView;
  let view: BarView | null = null;
  let host: HTMLElement | null = null;
  let bar: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function cancelFade() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  function remove() {
    cancelFade();
    host?.remove();
    host = null;
    bar = null;
  }

  function mount(): HTMLElement | null {
    if (bar) return bar;
    const parent = doc.documentElement;
    const el = doc.createElement("div");
    if (!parent || typeof el.attachShadow !== "function") return null;
    el.setAttribute(MARK_ATTR, "progress");
    el.setAttribute("style", HOST_STYLE);
    const root = el.attachShadow({ mode: "closed" });
    const style = doc.createElement("style");
    style.textContent = STYLE;
    bar = doc.createElement("div");
    bar.className = "bar";
    root.append(style, bar);
    parent.append(el);
    host = el;
    return bar;
  }

  return {
    update(state) {
      // a finished bar must not seed the next run with 100%
      view = nextBarView(state, view?.finishing ? null : view);
      if (!view.visible) {
        remove();
        return;
      }
      const el = mount();
      if (!el) return;
      cancelFade();
      el.style.width = `${view.fraction * 100}%`;
      el.classList.toggle("paused", view.tone === "paused");
      el.classList.toggle("done", view.finishing);
      if (!view.finishing) return;
      if (win?.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        remove();
        return;
      }
      timer = setTimeout(remove, FADE_MS);
    },
    destroy() {
      view = null;
      remove();
    },
  };
}
