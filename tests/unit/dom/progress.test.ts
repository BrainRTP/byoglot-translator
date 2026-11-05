import { describe, expect, it } from "vitest";
import { type BarView, nextBarView } from "../../../lib/dom/progress";
import type { PageState } from "../../../lib/messaging/protocol";

const st = (state: PageState["state"], done = 0, total = 0): PageState => ({
  state,
  done,
  total,
  failed: 0,
});

const bar = (fraction: number, tone: BarView["tone"] = "run"): BarView => ({
  visible: true,
  fraction,
  tone,
  finishing: false,
});

describe("nextBarView", () => {
  it("grows with done/total", () => {
    expect(nextBarView(st("translating", 1, 4), null)).toEqual(bar(0.25));
  });

  it("never goes back when total grows", () => {
    const a = nextBarView(st("translating", 10, 40), bar(0.5));
    expect(a.fraction).toBe(0.5);
    expect(nextBarView(st("translating", 30, 40), a).fraction).toBe(0.75);
  });

  it("fills and finishes when translated", () => {
    expect(nextBarView(st("translated", 4, 4), null)).toEqual({
      visible: true,
      fraction: 1,
      tone: "run",
      finishing: true,
    });
  });

  it("keeps the fraction and pauses on error", () => {
    expect(nextBarView(st("error", 1, 10), bar(0.4))).toEqual(bar(0.4, "paused"));
  });

  it("resumes from the paused fraction", () => {
    expect(nextBarView(st("translating", 2, 10), bar(0.4, "paused"))).toEqual(bar(0.4));
  });

  it("hides on idle", () => {
    expect(nextBarView(st("idle"), bar(0.4))).toEqual({
      visible: false,
      fraction: 0,
      tone: "run",
      finishing: false,
    });
  });

  it("zero total keeps the previous fraction", () => {
    expect(nextBarView(st("translating", 0, 0), bar(0.3)).fraction).toBe(0.3);
    expect(nextBarView(st("translating", 0, 0), null).fraction).toBe(0);
  });
});
