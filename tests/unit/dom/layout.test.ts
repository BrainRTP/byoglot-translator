import { beforeEach, describe, expect, it } from "vitest";
import type { Block } from "../../../lib/dom/extract";
import {
  containsComposed,
  findMainRoot,
  laneOf,
  orderByPosition,
  type RectOf,
} from "../../../lib/dom/layout";

type Rect = { left: number; right: number; top: number; width: number; height: number };

const ZERO: Rect = { left: 0, right: 0, top: 0, width: 0, height: 0 };

function rect(left: number, top: number, width: number, height: number): Rect {
  return { left, right: left + width, top, width, height };
}

function makeRectOf(map: Map<Element, Rect>): RectOf {
  return (el) => map.get(el) ?? ZERO;
}

function block(element: Element, chars = 100): Block {
  return { id: "b", element, source: "x".repeat(chars), slots: [], textNodes: [] };
}

const VW = 1000;

function $(selector: string): Element {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`missing ${selector}`);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("findMainRoot", () => {
  it("picks main even when the sidebar comes first in the DOM", () => {
    document.body.innerHTML = `<div id="side"><p>a</p></div><main><p>b</p></main>`;
    const main = document.querySelector("main") as Element;
    const side = document.querySelector("#side") as Element;
    const rects = new Map([
      [side, rect(0, 0, 200, 800)],
      [main, rect(250, 0, 600, 800)],
    ]);
    expect(findMainRoot(document, [], makeRectOf(rects), VW)).toBe(main);
  });

  it("picks [role=main] when there is no main", () => {
    document.body.innerHTML = `<div id="a"></div><div id="b" role="main"></div>`;
    const el = document.querySelector("#b") as Element;
    const rects = new Map([[el, rect(0, 0, 500, 500)]]);
    expect(findMainRoot(document, [], makeRectOf(rects), VW)).toBe(el);
  });

  it("takes the larger of two mains and skips a zero-area one", () => {
    document.body.innerHTML = `<main id="a"></main><main id="b"></main><main id="c"></main>`;
    const [a, b, c] = ["#a", "#b", "#c"].map($) as [Element, Element, Element];
    const rects = new Map([
      [a, rect(0, 0, 100, 100)],
      [b, rect(0, 0, 400, 400)],
      [c, rect(0, 0, 0, 900)],
    ]);
    expect(findMainRoot(document, [], makeRectOf(rects), VW)).toBe(b);
  });

  it("skips a hidden main in favour of an article", () => {
    document.body.innerHTML = `<main id="m"></main><article id="a"></article>`;
    const art = document.querySelector("article") as Element;
    const rects = new Map([[art, rect(0, 0, 300, 300)]]);
    expect(findMainRoot(document, [], makeRectOf(rects), VW)).toBe(art);
  });

  it("picks the largest article when there is no main", () => {
    document.body.innerHTML = `<article id="a"></article><article id="b"></article>`;
    const [a, b] = ["#a", "#b"].map($) as [Element, Element];
    const rects = new Map([
      [a, rect(0, 0, 100, 100)],
      [b, rect(0, 0, 300, 300)],
    ]);
    expect(findMainRoot(document, [], makeRectOf(rects), VW)).toBe(b);
  });

  describe("article and main share checks", () => {
    it("rejects an article when many equal cards split the text, falling back to the heuristic", () => {
      document.body.innerHTML = `
        <div id="feed">
          <article id="a1"><p id="p1"></p></article>
          <article id="a2"><p id="p2"></p></article>
          <article id="a3"><p id="p3"></p></article>
        </div>`;
      const rects = new Map<Element, Rect>([
        [$("#feed"), rect(100, 0, 800, 600)],
        [$("#a1"), rect(100, 0, 800, 100)],
        [$("#a2"), rect(100, 200, 800, 100)],
        [$("#a3"), rect(100, 400, 800, 300)],
        [$("#p1"), rect(100, 0, 800, 100)],
        [$("#p2"), rect(100, 200, 800, 100)],
        [$("#p3"), rect(100, 400, 800, 100)],
      ]);
      const blocks = [block($("#p1")), block($("#p2")), block($("#p3"))];
      expect(findMainRoot(document, blocks, makeRectOf(rects), VW)).toBe($("#feed"));
    });

    it("accepts a single big article that holds 80% of the text", () => {
      document.body.innerHTML = `
        <div id="side"><p id="s1"></p></div>
        <article id="art"><p id="a1"></p><p id="a2"></p></article>`;
      const rects = new Map<Element, Rect>([
        [$("#side"), rect(0, 0, 150, 500)],
        [$("#s1"), rect(0, 0, 150, 50)],
        [$("#art"), rect(200, 0, 600, 800)],
        [$("#a1"), rect(200, 0, 600, 50)],
        [$("#a2"), rect(200, 60, 600, 50)],
      ]);
      const blocks = [block($("#s1"), 100), block($("#a1"), 200), block($("#a2"), 200)];
      expect(findMainRoot(document, blocks, makeRectOf(rects), VW)).toBe($("#art"));
    });

    it("rejects a semantic main that holds less than half of the text", () => {
      document.body.innerHTML = `
        <main id="m"><p id="m1"></p></main>
        <div id="big"><p id="b1"></p><p id="b2"></p></div>`;
      const rects = new Map<Element, Rect>([
        [$("#m"), rect(100, 0, 100, 100)],
        [$("#m1"), rect(100, 0, 100, 100)],
        [$("#big"), rect(200, 0, 600, 800)],
        [$("#b1"), rect(200, 0, 600, 50)],
        [$("#b2"), rect(200, 60, 600, 50)],
      ]);
      const blocks = [block($("#m1"), 100), block($("#b1"), 300), block($("#b2"), 300)];
      expect(findMainRoot(document, blocks, makeRectOf(rects), VW)).toBe($("#big"));
    });
  });

  describe("semantic root refinement", () => {
    it("narrows main to the wide article div when main also wraps a side column", () => {
      document.body.innerHTML = `
        <main id="m">
          <div id="article"><p id="a1"></p><p id="a2"></p></div>
          <div id="tools"><p id="t1"></p></div>
        </main>`;
      const rects = new Map<Element, Rect>([
        [$("#m"), rect(0, 0, 1000, 800)],
        [$("#article"), rect(200, 0, 600, 800)],
        [$("#a1"), rect(200, 0, 600, 50)],
        [$("#a2"), rect(200, 60, 600, 50)],
        [$("#tools"), rect(850, 0, 150, 300)],
        [$("#t1"), rect(850, 0, 150, 50)],
      ]);
      const blocks = [block($("#a1"), 400), block($("#a2"), 400), block($("#t1"), 200)];
      expect(findMainRoot(document, blocks, makeRectOf(rects), VW)).toBe($("#article"));
    });

    it("keeps main when the heuristic finds nothing deeper", () => {
      document.body.innerHTML = `<main id="m"><p id="p1"></p><p id="p2"></p></main>`;
      const rects = new Map<Element, Rect>([
        [$("#m"), rect(200, 0, 600, 800)],
        [$("#p1"), rect(200, 0, 600, 50)],
        [$("#p2"), rect(200, 60, 600, 50)],
      ]);
      const blocks = [block($("#p1")), block($("#p2"))];
      expect(findMainRoot(document, blocks, makeRectOf(rects), VW)).toBe($("#m"));
    });
  });

  describe("heuristic", () => {
    it("walks through a shadow root to the wide central container", () => {
      document.body.innerHTML = `
        <div id="nav"><p id="n1"></p></div>
        <div id="content"><div id="host"></div></div>`;
      const host = $("#host");
      const root = host.attachShadow({ mode: "open" });
      root.innerHTML = `<p id="in1"></p><p id="in2"></p>`;
      const in1 = root.querySelector("#in1") as Element;
      const in2 = root.querySelector("#in2") as Element;
      const rects = new Map<Element, Rect>([
        [$("#nav"), rect(0, 0, 200, 800)],
        [$("#n1"), rect(0, 0, 200, 50)],
        [$("#content"), rect(250, 0, 600, 800)],
        [host, rect(250, 0, 600, 800)],
        [in1, rect(250, 0, 600, 50)],
        [in2, rect(250, 60, 600, 50)],
      ]);
      const blocks = [block($("#n1"), 200), block(in1, 400), block(in2, 400)];
      expect(findMainRoot(document, blocks, makeRectOf(rects), VW)).toBe(host);
    });

    it("returns the wide central container, not body or the inner paragraph", () => {
      document.body.innerHTML = `
        <div id="nav"><p id="n1"></p></div>
        <div id="content"><p id="c1"></p><p id="c2"></p></div>`;
      const rects = new Map<Element, Rect>([
        [$("#nav"), rect(0, 0, 200, 800)],
        [$("#n1"), rect(0, 0, 200, 50)],
        [$("#content"), rect(250, 0, 600, 800)],
        [$("#c1"), rect(250, 0, 600, 50)],
        [$("#c2"), rect(250, 60, 600, 50)],
      ]);
      const blocks = [block($("#n1"), 200), block($("#c1"), 400), block($("#c2"), 400)];
      expect(findMainRoot(document, blocks, makeRectOf(rects), VW)).toBe($("#content"));
    });

    it("returns null when no ancestor has 50% of the text at 40% width", () => {
      document.body.innerHTML = `
        <div id="a"><p id="p1"></p></div>
        <div id="b"><p id="p2"></p></div>
        <div id="c"><p id="p3"></p></div>`;
      const rects = new Map<Element, Rect>([
        [$("#a"), rect(100, 0, 800, 100)],
        [$("#b"), rect(100, 100, 800, 100)],
        [$("#c"), rect(100, 200, 800, 100)],
        [$("#p1"), rect(100, 0, 800, 100)],
        [$("#p2"), rect(100, 100, 800, 100)],
        [$("#p3"), rect(100, 200, 800, 100)],
      ]);
      const blocks = [block($("#p1")), block($("#p2")), block($("#p3"))];
      expect(findMainRoot(document, blocks, makeRectOf(rects), VW)).toBeNull();
    });

    it("returns null when the container is narrower than 40% of the viewport", () => {
      document.body.innerHTML = `<div id="c"><p id="p1"></p></div>`;
      const rects = new Map<Element, Rect>([
        [$("#c"), rect(400, 0, 200, 100)],
        [$("#p1"), rect(400, 0, 200, 100)],
      ]);
      expect(findMainRoot(document, [block($("#p1"))], makeRectOf(rects), VW)).toBeNull();
    });

    it("returns null when the viewport width is zero", () => {
      document.body.innerHTML = `<div id="c"><p id="p1"></p><p id="p2"></p></div>`;
      const blocks = [block($("#p1")), block($("#p2"))];
      expect(findMainRoot(document, blocks, makeRectOf(new Map()), 0)).toBeNull();
    });

    it("returns null for no blocks", () => {
      expect(findMainRoot(document, [], makeRectOf(new Map()), VW)).toBeNull();
    });
  });
});

describe("containsComposed", () => {
  it("is true for a descendant and for the root itself", () => {
    document.body.innerHTML = `<div id="r"><span id="s"></span></div><i id="o"></i>`;
    const r = document.querySelector("#r") as Element;
    expect(containsComposed(r, document.querySelector("#s") as Element)).toBe(true);
    expect(containsComposed(r, r)).toBe(true);
    expect(containsComposed(r, document.querySelector("#o") as Element)).toBe(false);
  });

  it("sees a block inside a shadow root whose host is in the main root", () => {
    document.body.innerHTML = `<div id="r"><div id="host"></div></div><div id="out"></div>`;
    const r = document.querySelector("#r") as Element;
    const host = document.querySelector("#host") as Element;
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<p id="inner"></p>`;
    const inner = root.querySelector("#inner") as Element;
    expect(containsComposed(r, inner)).toBe(true);
    expect(containsComposed(document.querySelector("#out") as Element, inner)).toBe(false);
  });
});

describe("laneOf", () => {
  it("is always main without a main root", () => {
    document.body.innerHTML = `<p id="p"></p>`;
    expect(laneOf(null, document.querySelector("#p") as Element)).toBe("main");
  });

  it("splits by containment", () => {
    document.body.innerHTML = `<main><p id="in"></p></main><p id="out"></p>`;
    const main = document.querySelector("main") as Element;
    expect(laneOf(main, document.querySelector("#in") as Element)).toBe("main");
    expect(laneOf(main, document.querySelector("#out") as Element)).toBe("side");
  });
});

describe("orderByPosition", () => {
  it("sorts by top, then left, keeping document order for ties", () => {
    document.body.innerHTML = `<p id="a"></p><p id="b"></p><p id="c"></p><p id="d"></p><p id="e"></p>`;
    const [a, b, c, d, e] = ["#a", "#b", "#c", "#d", "#e"].map($) as [
      Element,
      Element,
      Element,
      Element,
      Element,
    ];
    const rects = new Map<Element, Rect>([
      [a, rect(100, 50, 10, 10)],
      [b, rect(0, 50.4, 10, 10)],
      [c, rect(0, 10, 10, 10)],
      [d, rect(100, 50, 10, 10)],
      [e, rect(0, 51, 10, 10)],
    ]);
    const items = [a, b, c, d, e].map((element) => ({ element }));
    const sorted = orderByPosition(items, makeRectOf(rects)).map((i) => i.element);
    expect(sorted).toEqual([c, b, a, d, e]);
  });

  it("keeps document order when all rects are zero", () => {
    document.body.innerHTML = `<p></p><p></p><p></p>`;
    const items = Array.from(document.querySelectorAll("p")).map((element) => ({ element }));
    expect(orderByPosition(items, makeRectOf(new Map()))).toEqual(items);
  });

  it("sends zero-size (hidden) blocks after the visible ones in document order", () => {
    document.body.innerHTML = `<p id="h1"></p><p id="a"></p><p id="b"></p><p id="h2"></p>`;
    const [h1, a, b, h2] = ["#h1", "#a", "#b", "#h2"].map($) as [
      Element,
      Element,
      Element,
      Element,
    ];
    const rects = new Map<Element, Rect>([
      [a, rect(0, 300, 10, 10)],
      [b, rect(0, 100, 10, 10)],
    ]);
    const items = [h1, a, b, h2].map((element) => ({ element }));
    const sorted = orderByPosition(items, makeRectOf(rects)).map((i) => i.element);
    expect(sorted).toEqual([b, a, h1, h2]);
  });

  it("compares left descending when rtl", () => {
    document.body.innerHTML = `<p id="a"></p><p id="b"></p><p id="c"></p>`;
    const [a, b, c] = ["#a", "#b", "#c"].map($) as [Element, Element, Element];
    const rects = new Map<Element, Rect>([
      [a, rect(0, 50, 10, 10)],
      [b, rect(500, 50, 10, 10)],
      [c, rect(900, 10, 10, 10)],
    ]);
    const items = [a, b, c].map((element) => ({ element }));
    expect(orderByPosition(items, makeRectOf(rects), true).map((i) => i.element)).toEqual([
      c,
      b,
      a,
    ]);
    expect(orderByPosition(items, makeRectOf(rects)).map((i) => i.element)).toEqual([c, a, b]);
  });

  it("does not mutate the input", () => {
    document.body.innerHTML = `<p id="a"></p><p id="b"></p>`;
    const [a, b] = ["#a", "#b"].map($) as [Element, Element];
    const rects = new Map([[a, rect(0, 10, 1, 1)]]);
    const items = [a, b].map((element) => ({ element }));
    orderByPosition(items, makeRectOf(rects));
    expect(items.map((i) => i.element)).toEqual([a, b]);
  });
});
