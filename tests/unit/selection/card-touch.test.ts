import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCard, sheetRect } from "../../../lib/selection/card";

it("pins the card to the bottom edge with 8px margins", () => {
  expect(sheetRect(320, 640, 200)).toEqual({ left: 8, top: 432, width: 304, height: 200 });
});

it("caps the height at 60 percent of the viewport", () => {
  expect(sheetRect(360, 800, 2000)).toEqual({ left: 8, top: 312, width: 344, height: 480 });
});

describe("touch card viewport changes", () => {
  let root: HTMLElement;
  let card: ReturnType<typeof createCard>;

  beforeEach(() => {
    vi.stubGlobal("innerWidth", 360);
    vi.stubGlobal("innerHeight", 800);
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    root = document.createElement("div");
    document.body.append(root);
  });

  afterEach(() => {
    card?.close();
    root.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reapplies bottom sheet geometry on rotation without another translation", () => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(1000);
    const translate = vi.fn(() => new Promise<never>(() => {}));
    card = createCard(root, { translate, listTemplates: async () => [] });
    card.open({
      text: "text",
      context: "text",
      anchor: { left: 10, right: 90, top: 10, bottom: 30 },
    });
    const el = root.querySelector(".card") as HTMLElement;
    const position = () => ({
      left: el.style.left,
      top: el.style.top,
      width: el.style.width,
      height: el.style.height,
    });
    expect(position()).toEqual({ left: "8px", top: "312px", width: "344px", height: "480px" });

    vi.stubGlobal("innerWidth", 800);
    vi.stubGlobal("innerHeight", 360);
    window.dispatchEvent(new Event("resize"));
    expect(position()).toEqual({ left: "8px", top: "136px", width: "784px", height: "216px" });

    vi.stubGlobal("innerWidth", 360);
    vi.stubGlobal("innerHeight", 800);
    window.dispatchEvent(new Event("resize"));
    expect(position()).toEqual({ left: "8px", top: "312px", width: "344px", height: "480px" });
    expect(translate).toHaveBeenCalledTimes(1);
  });
});
