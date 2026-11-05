import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MARK_ATTR } from "../../../lib/dom/constants";
import { extractBlocks } from "../../../lib/dom/extract";
import { createProgressBar } from "../../../lib/dom/progress-bar";
import type { PageState } from "../../../lib/messaging/protocol";

const st = (state: PageState["state"], done = 0, total = 0): PageState => ({
  state,
  done,
  total,
  failed: 0,
});

const host = () => document.querySelector(`[${MARK_ATTR}="progress"]`);

beforeEach(() => {
  document.body.innerHTML = "";
  vi.useFakeTimers();
});

afterEach(() => {
  host()?.remove();
  vi.useRealTimers();
});

describe("createProgressBar", () => {
  it("creates the host on the first translating state", () => {
    createProgressBar(document).update(st("translating", 1, 4));
    expect(host()).not.toBeNull();
    expect(host()?.getAttribute("style")).toContain("pointer-events: none");
  });

  it("removes the host on idle", () => {
    const bar = createProgressBar(document);
    bar.update(st("translating", 1, 4));
    bar.update(st("idle"));
    expect(host()).toBeNull();
  });

  it("fades out and removes after translated", () => {
    const bar = createProgressBar(document);
    bar.update(st("translating", 1, 4));
    bar.update(st("translated", 4, 4));
    expect(host()).not.toBeNull();
    vi.advanceTimersByTime(400);
    expect(host()).toBeNull();
  });

  it("a new translating state cancels the fade", () => {
    const bar = createProgressBar(document);
    bar.update(st("translated", 4, 4));
    bar.update(st("translating", 1, 4));
    vi.advanceTimersByTime(1000);
    expect(host()).not.toBeNull();
  });

  it("destroy removes the host", () => {
    const bar = createProgressBar(document);
    bar.update(st("translating", 1, 4));
    bar.destroy();
    expect(host()).toBeNull();
  });

  it("extractBlocks skips the host", () => {
    document.body.innerHTML = "<p>Hello world, this is text.</p>";
    createProgressBar(document).update(st("translating", 1, 4));
    let n = 0;
    const blocks = extractBlocks(document.documentElement, {
      isTranslated: () => false,
      nextId: () => String(n++),
    });
    expect(blocks.map((b) => b.element.localName)).toEqual(["p"]);
  });
});
