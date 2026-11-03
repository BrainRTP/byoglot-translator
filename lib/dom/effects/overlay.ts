import { MARK_ATTR } from "../constants";

export type Overlay = {
  canvas(): CanvasRenderingContext2D | null;
  layer(): HTMLElement;
  // Clears the whole shared canvas; the animator calls it once per tick before the frames.
  beginFrame(): void;
  release(): void;
};

const HOST_STYLE = [
  "all: initial",
  "position: fixed",
  "inset: 0",
  "display: block",
  "pointer-events: none",
  "z-index: 2147483646",
]
  .map((d) => `${d} !important`)
  .join("; ");

const FILL = "position:absolute;top:0;left:0;pointer-events:none";

type Shared = {
  host: HTMLElement;
  root: ShadowRoot;
  holders: number;
  layer: HTMLElement | null;
  canvas: HTMLCanvasElement | null;
  ctx: CanvasRenderingContext2D | null;
  ctxTried: boolean;
};

const shared = new WeakMap<Document, Shared>();

function create(win: Window): Shared | null {
  const doc = win.document;
  const parent = doc.documentElement;
  if (!parent) return null;
  const host = doc.createElement("div");
  if (typeof host.attachShadow !== "function") return null;
  host.setAttribute(MARK_ATTR, "overlay");
  host.setAttribute("style", HOST_STYLE);
  const root = host.attachShadow({ mode: "closed" });
  parent.append(host);
  return { host, root, holders: 0, layer: null, canvas: null, ctx: null, ctxTried: false };
}

function canvasOf(win: Window, s: Shared): CanvasRenderingContext2D | null {
  if (s.ctxTried) return s.ctx;
  s.ctxTried = true;
  const canvas = win.document.createElement("canvas");
  if (typeof canvas.getContext !== "function") return null;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext("2d");
  } catch {
    ctx = null;
  }
  if (!ctx) return null;
  const dpr = win.devicePixelRatio > 0 ? win.devicePixelRatio : 1;
  canvas.width = Math.round(win.innerWidth * dpr);
  canvas.height = Math.round(win.innerHeight * dpr);
  canvas.setAttribute("style", `${FILL};width:${win.innerWidth}px;height:${win.innerHeight}px`);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  s.root.prepend(canvas);
  s.canvas = canvas;
  s.ctx = ctx;
  return ctx;
}

function layerOf(win: Window, s: Shared): HTMLElement {
  if (!s.layer) {
    const layer = win.document.createElement("div");
    layer.setAttribute("style", `${FILL};width:100%;height:100%;overflow:visible`);
    s.root.append(layer);
    s.layer = layer;
  }
  return s.layer;
}

export function acquireOverlay(win: Window): Overlay | null {
  const doc = win.document;
  let s = shared.get(doc);
  if (!s) {
    s = create(win) ?? undefined;
    if (!s) return null;
    shared.set(doc, s);
  }
  const state = s;
  state.holders++;
  let released = false;
  return {
    canvas: () => canvasOf(win, state),
    layer: () => layerOf(win, state),
    beginFrame() {
      if (released || !state.ctx) return;
      state.ctx.clearRect(0, 0, win.innerWidth, win.innerHeight);
    },
    release() {
      if (released) return;
      released = true;
      state.holders--;
      if (state.holders > 0) return;
      state.host.remove();
      if (shared.get(doc) === state) shared.delete(doc);
    },
  };
}
