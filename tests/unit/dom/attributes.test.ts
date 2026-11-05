import { beforeEach, describe, expect, it } from "vitest";
import { extractAttributes } from "../../../lib/dom/attributes";

function extract(html: string, isDone: (el: Element, a: string) => boolean = () => false) {
  document.body.innerHTML = html;
  let i = 0;
  return extractAttributes(document.body, { isDone, nextId: () => `a${++i}` });
}

const pairs = (html: string) => extract(html).map((b) => [b.attr, b.source]);

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("extractAttributes", () => {
  it("extracts title, alt and placeholder", () => {
    const blocks = extract(
      '<p title="Open menu">x</p><img alt="A cat"><input placeholder="Search docs">',
    );
    expect(blocks.map((b) => [b.attr, b.source])).toEqual([
      ["title", "Open menu"],
      ["alt", "A cat"],
      ["placeholder", "Search docs"],
    ]);
    expect(blocks[0]?.slots).toEqual([]);
    expect(blocks[0]?.textNodes).toEqual([]);
  });

  it("skips values without letters", () => {
    expect(pairs('<p title="123">x</p><img alt="">')).toEqual([]);
  });

  it("skips code, notranslate and hidden", () => {
    expect(
      pairs(
        '<code title="Run it">x</code><span class="notranslate" title="Keep">x</span><div hidden><img alt="Hidden"></div>',
      ),
    ).toEqual([]);
  });

  it("takes placeholder only from text-like inputs", () => {
    expect(
      pairs(
        '<input type="hidden" placeholder="Hid den"><input type="checkbox" placeholder="Che ck"><input type="email" placeholder="Your email"><textarea placeholder="Say more"></textarea>',
      ),
    ).toEqual([
      ["placeholder", "Your email"],
      ["placeholder", "Say more"],
    ]);
  });

  it("takes alt only from img, area and image inputs", () => {
    expect(
      pairs('<div alt="x y"></div><input type="image" alt="Go now"><area alt="Map part">'),
    ).toEqual([
      ["alt", "Go now"],
      ["alt", "Map part"],
    ]);
  });

  it("skips a field that is itself hidden", () => {
    expect(pairs('<input hidden placeholder="Nope">')).toEqual([]);
  });

  it("respects isDone", () => {
    const blocks = extract(
      '<p title="Open menu">x</p><p title="Other">y</p>',
      (el) => el.textContent === "x",
    );
    expect(blocks.map((b) => b.source)).toEqual(["Other"]);
  });

  it("reads open shadow roots", () => {
    document.body.innerHTML = "<div id='h'></div>";
    const root = (document.getElementById("h") as Element).attachShadow({ mode: "open" });
    root.innerHTML = '<span title="Inside shadow">x</span>';
    const blocks = extractAttributes(document.body, { isDone: () => false, nextId: () => "a" });
    expect(blocks.map((b) => b.source)).toEqual(["Inside shadow"]);
  });
});
