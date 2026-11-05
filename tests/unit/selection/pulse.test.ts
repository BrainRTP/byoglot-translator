import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pulseText } from "../../../lib/selection/pulse";

class FakeHighlight {
  ranges: AbstractRange[];
  constructor(...ranges: AbstractRange[]) {
    this.ranges = ranges;
  }
}

const styleEl = () => document.head.querySelector('style[data-byoglot="pulse"]');
const highlights = () => (CSS as unknown as { highlights: Map<string, unknown> }).highlights;

function texts(): Text[] {
  document.body.innerHTML =
    '<p style="color: rgb(0, 0, 0)">one</p><p style="color: rgb(0, 0, 255)">two</p>';
  return [...document.querySelectorAll("p")].map((p) => p.firstChild as Text);
}

beforeEach(() => {
  document.head.innerHTML = "";
  vi.stubGlobal("CSS", { highlights: new Map() });
  vi.stubGlobal("Highlight", FakeHighlight);
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("pulseText", () => {
  it("groups text by color into highlights and injects a style", () => {
    const stop = pulseText(document, texts());
    expect([...highlights().keys()]).toEqual(["byoglot-pulse-0", "byoglot-pulse-1"]);
    expect(styleEl()?.textContent).toContain("::highlight(byoglot-pulse-0)");
    expect(styleEl()?.textContent).toContain("rgb(0 0 0 / ");
    stop();
  });

  it("stop removes highlights and the style, and is idempotent", () => {
    const stop = pulseText(document, texts());
    stop();
    stop();
    expect(highlights().size).toBe(0);
    expect(styleEl()).toBeNull();
  });

  it("reduced motion uses a constant 0.6 factor", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const raf = vi.spyOn(globalThis, "requestAnimationFrame");
    const stop = pulseText(document, texts());
    expect(styleEl()?.textContent).toContain("rgb(0 0 0 / 0.6)");
    expect(raf).not.toHaveBeenCalled();
    stop();
  });

  it("is a no-op without CSS.highlights", () => {
    vi.stubGlobal("CSS", {});
    const stop = pulseText(document, texts());
    expect(styleEl()).toBeNull();
    expect(() => stop()).not.toThrow();
  });
});
