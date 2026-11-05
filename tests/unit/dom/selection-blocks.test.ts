import { beforeEach, describe, expect, it } from "vitest";
import { selectionBlocks } from "../../../lib/dom/selection-blocks";

function ids() {
  let i = 0;
  return () => `b${++i}`;
}

function text(el: Element, n = 0): Text {
  const walker = document.createTreeWalker(el, 4);
  let node = walker.nextNode();
  for (let i = 0; i < n; i++) node = walker.nextNode();
  return node as Text;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("selectionBlocks", () => {
  it("encodes only the selected words of a paragraph", () => {
    document.body.innerHTML = "<p id=p>Hello big world</p>";
    const p = document.getElementById("p") as Element;
    const range = document.createRange();
    range.setStart(text(p), 6);
    range.setEnd(text(p), 9);
    const blocks = selectionBlocks(range, ids());
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.element).toBe(p);
    expect(blocks[0]?.source).toBe("big");
    expect(p.innerHTML).toBe("Hello big world");
  });

  it("keeps a partially selected link as a slot", () => {
    document.body.innerHTML = '<p>See <a href="/x">the wiki page</a> now</p>';
    const a = document.querySelector("a") as Element;
    const p = document.querySelector("p") as Element;
    const range = document.createRange();
    range.setStart(text(a), 4);
    range.setEnd(text(p, 2), 4);
    const blocks = selectionBlocks(range, ids());
    expect(blocks[0]?.source).toBe("<x1>wiki page</x1> now");
    expect(blocks[0]?.slots[0]?.node).toBe(a);
    expect(document.querySelectorAll("a").length).toBe(1);
  });

  it("splits a cross-paragraph selection into one block per paragraph", () => {
    document.body.innerHTML = "<p id=a>One two</p><p id=b>three four</p>";
    const a = document.getElementById("a") as Element;
    const b = document.getElementById("b") as Element;
    const range = document.createRange();
    range.setStart(text(a), 4);
    range.setEnd(text(b), 5);
    const blocks = selectionBlocks(range, ids());
    expect(blocks.map((x) => x.source)).toEqual(["two", "three"]);
    expect(blocks.map((x) => x.element)).toEqual([a, b]);
    expect(a.textContent).toBe("One two");
    expect(b.textContent).toBe("three four");
  });

  it("skips code and own marks", () => {
    document.body.innerHTML = "<p>run <code>npm i</code> now</p><span data-byoglot>x</span>";
    const range = document.createRange();
    range.selectNodeContents(document.body);
    const blocks = selectionBlocks(range, ids());
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.source).toBe("run <x1/> now");
    for (const b of blocks) expect(b.element.closest("[data-byoglot]")).toBeNull();
  });

  it("returns nothing for a collapsed or detached range", () => {
    document.body.innerHTML = "<p id=p>Hello</p>";
    const p = document.getElementById("p") as Element;
    const range = document.createRange();
    range.setStart(text(p), 1);
    expect(selectionBlocks(range, ids())).toEqual([]);
    range.setEnd(text(p), 3);
    p.remove();
    expect(selectionBlocks(range, ids())).toEqual([]);
  });
});
