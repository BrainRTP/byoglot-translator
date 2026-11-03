import { describe, expect, it } from "vitest";
import { renderSafeMarkdown } from "../../../lib/selection/markdown";

function render(text: string) {
  const host = document.createElement("div");
  host.append(renderSafeMarkdown(text, document));
  return host;
}

describe("renderSafeMarkdown", () => {
  it("never creates elements from raw html", () => {
    const host = render("<img src=x onerror=alert(1)> **b**");
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector("strong")?.textContent).toBe("b");
    expect(host.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("renders unordered and ordered lists", () => {
    const ul = render("- one\n- two\n* three");
    expect(ul.querySelectorAll("ul > li")).toHaveLength(3);
    const ol = render("1. a\n2. b");
    expect(ol.querySelectorAll("ol > li")).toHaveLength(2);
  });

  it("renders paragraphs, italic and code", () => {
    const host = render("first *it* `x < y`\n\nsecond");
    expect(host.querySelectorAll("p")).toHaveLength(2);
    expect(host.querySelector("em")?.textContent).toBe("it");
    expect(host.querySelector("code")?.textContent).toBe("x < y");
  });

  it("keeps unmatched markers as text", () => {
    const host = render("2 * 3 = 6 and **open");
    expect(host.textContent).toBe("2 * 3 = 6 and **open");
  });

  it("does not treat a plain segment wrapped in asterisks as emphasis", () => {
    const host = render("- *  x  *");
    expect(host.querySelector("em")).toBeNull();
    expect(host.querySelector("li")?.textContent).toBe("*  x  *");
  });

  it("renders a heading line as a muted label paragraph", () => {
    const host = render("## Values\n\ntext");
    expect(host.querySelector("p.h")?.textContent).toBe("Values");
  });
});
