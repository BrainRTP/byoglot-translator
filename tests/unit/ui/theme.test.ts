import { describe, expect, it } from "vitest";
import { applyTheme, recallLook, rememberLook } from "../../../lib/ui/theme";

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

describe("look cache", () => {
  it("keeps theme and ui language for the next open", () => {
    localStorage.clear();
    expect(recallLook()).toBeNull();
    rememberLook({ theme: "dark", uiLang: "ru" });
    expect(recallLook()).toEqual({ theme: "dark", uiLang: "ru" });
  });
});
