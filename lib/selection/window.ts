export type WindowRect = { left: number; top: number; width: number; height: number };

export const SAFE_ZONE = 16;
export const EDGE = 8;
export const MIN_WIDTH = 280;
export const MIN_HEIGHT = 160;

export type WindowShell = {
  rect(): WindowRect;
  setRect(r: WindowRect): void;
  wasResized(): boolean;
  inSafeZone(x: number, y: number): boolean;
  destroy(): void;
};

const between = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

export function clampRect(r: WindowRect, vw: number, vh: number): WindowRect {
  const width = between(r.width, MIN_WIDTH, vw - 2 * EDGE);
  const height = between(r.height, MIN_HEIGHT, vh - 2 * EDGE);
  return {
    left: between(r.left, EDGE, vw - EDGE - width),
    top: between(r.top, EDGE, vh - EDGE - height),
    width,
    height,
  };
}

type Gesture = { kind: "drag" | "resize"; id: number; x: number; y: number; from: WindowRect };

export function attachWindow(
  el: HTMLElement,
  handle: HTMLElement,
  onResize?: () => void,
): WindowShell {
  const box = el.getBoundingClientRect();
  let current: WindowRect = { left: box.left, top: box.top, width: box.width, height: box.height };
  let resized = false;
  let gesture: Gesture | undefined;

  const grip = el.ownerDocument.createElement("div");
  grip.className = "grip";
  el.append(grip);

  const applyPosition = () => {
    el.style.left = `${current.left}px`;
    el.style.top = `${current.top}px`;
  };
  const applySize = () => {
    el.style.width = `${current.width}px`;
    el.style.height = `${current.height}px`;
  };
  const clamp = (r: WindowRect) => clampRect(r, window.innerWidth, window.innerHeight);

  const begin = (kind: Gesture["kind"], e: PointerEvent) => {
    const target = e.currentTarget as HTMLElement;
    gesture = { kind, id: e.pointerId, x: e.clientX, y: e.clientY, from: current };
    target.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };

  const onHandleDown = (e: PointerEvent) => {
    if (e.button > 0) return;
    if ((e.target as Element | null)?.closest("button,select,input")) return;
    begin("drag", e);
  };
  const onGripDown = (e: PointerEvent) => {
    if (e.button > 0) return;
    begin("resize", e);
  };

  const onMove = (e: PointerEvent) => {
    if (!gesture || e.pointerId !== gesture.id) return;
    const dx = e.clientX - gesture.x;
    const dy = e.clientY - gesture.y;
    const { from } = gesture;
    if (gesture.kind === "drag") {
      current = clamp({ ...from, left: from.left + dx, top: from.top + dy });
      applyPosition();
      return;
    }
    const width = Math.max(
      MIN_WIDTH,
      Math.min(from.width + dx, window.innerWidth - EDGE - from.left),
    );
    const height = Math.max(
      MIN_HEIGHT,
      Math.min(from.height + dy, window.innerHeight - EDGE - from.top),
    );
    current = clamp({ ...from, width, height });
    resized = true;
    applySize();
    onResize?.();
  };

  const onUp = (e: PointerEvent) => {
    if (gesture && e.pointerId === gesture.id) gesture = undefined;
  };

  const onViewport = () => {
    const next = clamp(current);
    const sizeChanged = next.width !== current.width || next.height !== current.height;
    current = next;
    applyPosition();
    if (resized || sizeChanged) applySize();
  };

  handle.addEventListener("pointerdown", onHandleDown);
  grip.addEventListener("pointerdown", onGripDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  window.addEventListener("resize", onViewport);

  return {
    rect: () => ({ ...current }),
    setRect(r) {
      current = clamp(r);
      applyPosition();
      applySize();
    },
    wasResized: () => resized,
    inSafeZone: (x, y) =>
      x >= current.left - SAFE_ZONE &&
      x <= current.left + current.width + SAFE_ZONE &&
      y >= current.top - SAFE_ZONE &&
      y <= current.top + current.height + SAFE_ZONE,
    destroy() {
      handle.removeEventListener("pointerdown", onHandleDown);
      grip.removeEventListener("pointerdown", onGripDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("resize", onViewport);
      grip.remove();
      gesture = undefined;
    },
  };
}
