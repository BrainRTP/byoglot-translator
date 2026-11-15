import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCard, type SelectionTranslation, sheetRect } from "../../../lib/selection/card";
import { builtinTemplate } from "../../../lib/settings/defaults";

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

  it("explains a deleted template and refreshes the pinned card picker before retry", async () => {
    const builtin = builtinTemplate();
    const custom = { ...builtin, id: "removed", builtin: false, name: "Custom" };
    const listTemplates = vi
      .fn()
      .mockResolvedValueOnce([builtin, custom])
      .mockResolvedValue([builtin]);
    const translate = vi
      .fn<() => Promise<SelectionTranslation>>()
      .mockResolvedValue({ text: "First" });
    card = createCard(root, { translate, listTemplates, currentTemplateId: async () => custom.id });
    const req = { text: "text", context: "", anchor: { left: 10, right: 90, top: 10, bottom: 30 } };
    card.open(req);
    await vi.waitFor(() => expect(root.querySelectorAll("option")).toHaveLength(2));
    card.setMode("pinned");
    const select = root.querySelector("select") as HTMLSelectElement;
    select.value = "removed";
    translate.mockResolvedValueOnce({ error: "unknown_template", backend: "provider" });
    card.add(req);
    await vi.waitFor(() => expect(root.querySelectorAll("option")).toHaveLength(1));
    expect(root.querySelector("[role=alert]")?.textContent).toContain("Template no longer exists");
    expect(root.textContent).not.toContain("OpenAI-compatible");
    expect(select.value).toBe(builtin.id);
    card.add(req);
    expect(translate.mock.calls.at(-1)).toEqual(["text", "", builtin.id, "pinned"]);
  });
});
