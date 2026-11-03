import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachWindow, clampRect, type WindowShell } from "../../../lib/selection/window";

const start = { left: 100, top: 100, width: 300, height: 200 };

let el: HTMLElement;
let handle: HTMLElement;
let shell: WindowShell | undefined;

function pointer(target: EventTarget, type: string, x: number, y: number) {
  target.dispatchEvent(
    new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, bubbles: true, composed: true }),
  );
}

beforeEach(() => {
  vi.stubGlobal("innerWidth", 1000);
  vi.stubGlobal("innerHeight", 800);
  el = document.createElement("div");
  handle = document.createElement("div");
  el.append(handle);
  document.body.append(el);
});

afterEach(() => {
  shell?.destroy();
  shell = undefined;
  el.remove();
  vi.unstubAllGlobals();
});

describe("clampRect", () => {
  it("moves the window inside the viewport", () => {
    expect(clampRect({ left: -50, top: 900, width: 300, height: 200 }, 1000, 800)).toEqual({
      left: 8,
      top: 592,
      width: 300,
      height: 200,
    });
  });

  it("keeps minimum and maximum size", () => {
    expect(clampRect({ left: 8, top: 8, width: 100, height: 50 }, 1000, 800)).toMatchObject({
      width: 280,
      height: 160,
    });
    expect(clampRect({ left: 8, top: 8, width: 2000, height: 2000 }, 1000, 800)).toMatchObject({
      width: 984,
      height: 784,
    });
  });
});

describe("attachWindow", () => {
  it("drags by the handle and writes left/top to style", () => {
    shell = attachWindow(el, handle);
    shell.setRect(start);
    pointer(handle, "pointerdown", 100, 100);
    pointer(handle, "pointermove", 150, 130);
    pointer(handle, "pointerup", 150, 130);
    expect(shell.rect()).toMatchObject({ left: 150, top: 130, width: 300, height: 200 });
    expect(el.style.left).toBe("150px");
    expect(el.style.top).toBe("130px");
  });

  it("stops dragging after pointerup", () => {
    shell = attachWindow(el, handle);
    shell.setRect(start);
    pointer(handle, "pointerdown", 100, 100);
    pointer(handle, "pointerup", 100, 100);
    pointer(handle, "pointermove", 300, 300);
    expect(shell.rect().left).toBe(100);
  });

  it("does not start a drag from a button or select inside the handle", () => {
    const button = document.createElement("button");
    const select = document.createElement("select");
    handle.append(button, select);
    shell = attachWindow(el, handle);
    shell.setRect(start);
    for (const control of [button, select]) {
      pointer(control, "pointerdown", 100, 100);
      pointer(control, "pointermove", 150, 130);
      pointer(control, "pointerup", 150, 130);
    }
    expect(shell.rect()).toMatchObject({ left: 100, top: 100 });
  });

  it("resizes by the grip and reports it", () => {
    const onResize = vi.fn();
    shell = attachWindow(el, handle, onResize);
    shell.setRect(start);
    expect(shell.wasResized()).toBe(false);
    const grip = el.querySelector<HTMLElement>(".grip");
    if (!grip) throw new Error("no grip");
    pointer(grip, "pointerdown", 400, 300);
    pointer(grip, "pointermove", 440, 320);
    pointer(grip, "pointerup", 440, 320);
    expect(shell.rect()).toMatchObject({ left: 100, top: 100, width: 340, height: 220 });
    expect(el.style.width).toBe("340px");
    expect(el.style.height).toBe("220px");
    expect(shell.wasResized()).toBe(true);
    expect(onResize).toHaveBeenCalled();
  });

  it("stops growing at the right and bottom edge without moving the window", () => {
    shell = attachWindow(el, handle);
    shell.setRect({ left: 600, top: 500, width: 300, height: 200 });
    const grip = el.querySelector<HTMLElement>(".grip");
    if (!grip) throw new Error("no grip");
    pointer(grip, "pointerdown", 900, 700);
    pointer(grip, "pointermove", 1000, 800);
    expect(shell.rect()).toEqual({ left: 600, top: 500, width: 392, height: 292 });
    pointer(grip, "pointerup", 1000, 800);
  });

  it("extends the safe zone by 16px around the rect", () => {
    shell = attachWindow(el, handle);
    shell.setRect(start);
    expect(shell.inSafeZone(90, 90)).toBe(true);
    expect(shell.inSafeZone(80, 100)).toBe(false);
    expect(shell.inSafeZone(416, 300)).toBe(true);
    expect(shell.inSafeZone(417, 300)).toBe(false);
  });

  it("re-clamps the rect when the viewport shrinks", () => {
    shell = attachWindow(el, handle);
    shell.setRect({ left: 600, top: 100, width: 300, height: 200 });
    vi.stubGlobal("innerWidth", 700);
    window.dispatchEvent(new Event("resize"));
    expect(shell.rect().left).toBe(392);
    expect(el.style.left).toBe("392px");
  });

  it("removes the grip and listeners on destroy", () => {
    shell = attachWindow(el, handle);
    shell.setRect(start);
    shell.destroy();
    expect(el.querySelector(".grip")).toBeNull();
    pointer(handle, "pointerdown", 100, 100);
    pointer(handle, "pointermove", 150, 130);
    expect(shell.rect().left).toBe(100);
  });
});
