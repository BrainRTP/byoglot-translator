import { describe, expect, it } from "vitest";
import { applyTheme } from "../../../lib/ui/theme";

describe("applyTheme", () => {
  it("sets data-theme for light and dark and removes it for system", () => {
    const el = document.createElement("div");
    applyTheme(el, "dark");
    expect(el.getAttribute("data-theme")).toBe("dark");
    applyTheme(el, "system");
    expect(el.hasAttribute("data-theme")).toBe(false);
    applyTheme(el, "light");
    expect(el.getAttribute("data-theme")).toBe("light");
  });
});
