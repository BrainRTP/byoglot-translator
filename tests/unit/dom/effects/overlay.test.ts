import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MARK_ATTR } from "../../../../lib/dom/constants";
import { acquireOverlay } from "../../../../lib/dom/effects/overlay";

type FakeCtx = {
  canvas: HTMLCanvasElement;
  setTransform: ReturnType<typeof vi.fn>;
  clearRect: ReturnType<typeof vi.fn>;
};

function hosts(): Element[] {
  return [...document.querySelectorAll(`[${MARK_ATTR}]`)];
}

function stubContext() {
  const made: FakeCtx[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    const ctx: FakeCtx = { canvas: this, setTransform: vi.fn(), clearRect: vi.fn() };
    made.push(ctx);
    return ctx as unknown as RenderingContext;
  } as never);
  return made;
}

beforeEach(() => {
  document.body.innerHTML = "";
  vi.stubGlobal("devicePixelRatio", 2);
  vi.stubGlobal("innerWidth", 800);
  vi.stubGlobal("innerHeight", 600);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("overlay host", () => {
  it("is not created until acquired", () => {
    expect(hosts()).toHaveLength(0);
  });

  it("creates one marked host with a closed shadow root and shares it", () => {
    const a = acquireOverlay(window);
    const b = acquireOverlay(window);
    const found = hosts();
    expect(found).toHaveLength(1);
    const host = found[0] as HTMLElement;
    expect(host.parentElement).toBe(document.documentElement);
    expect(host.shadowRoot).toBeNull();
    const style = host.getAttribute("style") ?? "";
    expect(style).toContain("position: fixed !important");
    expect(style).toContain("pointer-events: none !important");
    expect(style).toContain("z-index: 2147483646 !important");
    expect(style).toContain("all: initial !important");
    a?.release();
    b?.release();
  });

  it("is removed after the last release only", () => {
    const a = acquireOverlay(window);
    const b = acquireOverlay(window);
    a?.release();
    expect(hosts()).toHaveLength(1);
    b?.release();
    expect(hosts()).toHaveLength(0);
  });

  it("ignores a second release of the same handle", () => {
    const a = acquireOverlay(window);
    const b = acquireOverlay(window);
    a?.release();
    a?.release();
    expect(hosts()).toHaveLength(1);
    b?.release();
    expect(hosts()).toHaveLength(0);
  });

  it("creates a fresh host after the previous one was removed", () => {
    const a = acquireOverlay(window);
    const first = hosts()[0];
    a?.release();
    const b = acquireOverlay(window);
    expect(hosts()).toHaveLength(1);
    expect(hosts()[0]).not.toBe(first);
    b?.release();
  });
});

describe("overlay canvas", () => {
  it("is null when 2D context is unavailable", () => {
    const o = acquireOverlay(window);
    expect(o?.canvas()).toBeNull();
    o?.release();
  });

  it("is sized to viewport times devicePixelRatio and scaled to CSS px", () => {
    const made = stubContext();
    const o = acquireOverlay(window);
    const ctx = o?.canvas() as unknown as FakeCtx;
    expect(ctx.canvas.width).toBe(1600);
    expect(ctx.canvas.height).toBe(1200);
    expect(ctx.canvas.style.width).toBe("800px");
    expect(ctx.canvas.style.height).toBe("600px");
    expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    expect(ctx.canvas.isConnected).toBe(true);
    expect(made).toHaveLength(1);
    o?.release();
  });

  it("is one canvas shared by all handles", () => {
    const made = stubContext();
    const a = acquireOverlay(window);
    const b = acquireOverlay(window);
    expect(a?.canvas()).toBe(b?.canvas());
    expect(a?.canvas()).toBe(a?.canvas());
    expect(made).toHaveLength(1);
    a?.release();
    b?.release();
  });

  it("beginFrame wipes the whole shared canvas once, whoever calls it", () => {
    stubContext();
    const a = acquireOverlay(window);
    const b = acquireOverlay(window);
    const ctx = a?.canvas() as unknown as FakeCtx;
    b?.beginFrame();
    expect(ctx.clearRect).toHaveBeenCalledTimes(1);
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 800, 600);
    a?.release();
    b?.release();
  });

  it("beginFrame does nothing before the canvas exists or after release", () => {
    const made = stubContext();
    const a = acquireOverlay(window);
    const b = acquireOverlay(window);
    a?.beginFrame();
    expect(made).toHaveLength(0);
    const ctx = b?.canvas() as unknown as FakeCtx;
    a?.release();
    a?.beginFrame();
    expect(ctx.clearRect).not.toHaveBeenCalled();
    b?.release();
  });

  it("falls back to ratio 1 when devicePixelRatio is missing", () => {
    stubContext();
    vi.stubGlobal("devicePixelRatio", 0);
    const o = acquireOverlay(window);
    const ctx = o?.canvas() as unknown as FakeCtx;
    expect(ctx.canvas.width).toBe(800);
    o?.release();
  });
});

describe("overlay layer", () => {
  it("is one div inside the host, shared by handles", () => {
    const a = acquireOverlay(window);
    const b = acquireOverlay(window);
    const layer = a?.layer() as HTMLElement;
    expect(layer.tagName).toBe("DIV");
    expect(layer.isConnected).toBe(true);
    expect(layer.getRootNode()).not.toBe(document);
    expect(b?.layer()).toBe(layer);
    a?.release();
    b?.release();
  });
});
