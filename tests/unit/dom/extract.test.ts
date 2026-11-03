import { beforeEach, describe, expect, it } from "vitest";
import { BLOCK_ID_ATTR, MARK_ATTR } from "../../../lib/dom/constants";
import { extractBlocks, isSkippable } from "../../../lib/dom/extract";
import { encodeBlock } from "../../../lib/dom/placeholders";

function makeOpts(translated: Element[] = []) {
  let i = 0;
  return {
    isTranslated: (el: Element) => translated.includes(el),
    nextId: () => `b${++i}`,
  };
}

function extract(html: string, translated: Element[] = []) {
  document.body.innerHTML = html;
  return extractBlocks(document.body, makeOpts(translated));
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("encodeBlock", () => {
  it("replaces inline elements with numbered placeholders", () => {
    document.body.innerHTML =
      '<p id="p">Read the <a href="/d">docs</a> before you <b>deploy</b>.</p>';
    const p = document.getElementById("p") as Element;
    const enc = encodeBlock(p);
    expect(enc.source).toBe("Read the <x1>docs</x1> before you <x2>deploy</x2>.");
    expect(enc.slots.map((s) => s.node)).toEqual([p.querySelector("a"), p.querySelector("b")]);
    expect(enc.slots.every((s) => !s.selfClosing)).toBe(true);
    expect(enc.textNodes.map((t) => t.data)).toEqual([
      "Read the ",
      "docs",
      " before you ",
      "deploy",
      ".",
    ]);
  });

  it("encodes br as a self-closing slot", () => {
    document.body.innerHTML = '<p id="p">Line<br>next</p>';
    const enc = encodeBlock(document.getElementById("p") as Element);
    expect(enc.source).toBe("Line<x1/>next");
    expect(enc.slots[0]?.selfClosing).toBe(true);
  });

  it("numbers nested inline elements in opening order", () => {
    document.body.innerHTML = '<p id="p"><a><b>x</b></a></p>';
    const enc = encodeBlock(document.getElementById("p") as Element);
    expect(enc.source).toBe("<x1><x2>x</x2></x1>");
    expect(enc.slots.map((s) => s.n)).toEqual([1, 2]);
  });

  it("keeps an inline code as a self-closing slot pointing at the original element", () => {
    document.body.innerHTML = '<p id="p">Run <code>npm i</code> now</p>';
    const p = document.getElementById("p") as Element;
    const enc = encodeBlock(p);
    expect(enc.source).toBe("Run <x1/> now");
    expect(enc.slots[0]).toMatchObject({ n: 1, selfClosing: true, node: p.querySelector("code") });
    expect(enc.textNodes.map((t) => t.data)).toEqual(["Run ", " now"]);
  });

  it("ignores whitespace-only text nodes and does not create slots for them", () => {
    document.body.innerHTML = '<p id="p">\n  <a>A</a>\n  <b>B</b>\n</p>';
    const enc = encodeBlock(document.getElementById("p") as Element);
    expect(enc.source).toBe("<x1>A</x1> <x2>B</x2>");
    expect(enc.slots).toHaveLength(2);
    expect(enc.textNodes.map((t) => t.data)).toEqual(["A", "B"]);
  });

  it("keeps translate=no and .notranslate inlines as self-closing slots", () => {
    document.body.innerHTML =
      '<p id="p">Welcome to <span class="notranslate">Acme</span>! Visit <b translate="no">Foo</b> today</p>';
    const p = document.getElementById("p") as Element;
    const enc = encodeBlock(p);
    expect(enc.source).toBe("Welcome to <x1/>! Visit <x2/> today");
    expect(enc.slots.map((s) => [s.n, s.selfClosing, s.node])).toEqual([
      [1, true, p.querySelector("span")],
      [2, true, p.querySelector("b")],
    ]);
    expect(enc.textNodes.map((t) => t.data)).toEqual(["Welcome to ", "! Visit ", " today"]);
  });

  it("still drops hidden and non-text skipped inlines", () => {
    document.body.innerHTML =
      '<p id="p">A <span hidden>h</span><span aria-hidden="true">a</span><span style="display:none">d</span><svg></svg><input> B</p>';
    const enc = encodeBlock(document.getElementById("p") as Element);
    expect(enc.source).toBe("A B");
    expect(enc.slots).toEqual([]);
  });

  it("keeps a single space between inline elements and between text and inlines", () => {
    document.body.innerHTML =
      '<p id="p"><a>Home</a> <a>About</a></p><p id="q"><b>A</b> <i>B</i></p>';
    expect(encodeBlock(document.getElementById("p") as Element).source).toBe(
      "<x1>Home</x1> <x2>About</x2>",
    );
    const q = encodeBlock(document.getElementById("q") as Element);
    expect(q.source).toBe("<x1>A</x1> <x2>B</x2>");
    expect(q.textNodes.map((t) => t.data)).toEqual(["A", "B"]);
    expect(q.slots).toHaveLength(2);
  });

  it("drops whitespace at block edges and right inside slot edges", () => {
    document.body.innerHTML = '<p id="p"> \n <a> <b>x</b> </a> <i>y</i> \n </p>';
    expect(encodeBlock(document.getElementById("p") as Element).source).toBe(
      "<x1><x2>x</x2></x1> <x3>y</x3>",
    );
  });

  it("does not descend into nested block elements", () => {
    document.body.innerHTML = '<li id="p">Item <ul><li>Sub</li></ul></li>';
    const enc = encodeBlock(document.getElementById("p") as Element);
    expect(enc.source).toBe("Item");
  });

  it("drops empty inline elements without consuming a number", () => {
    document.body.innerHTML = '<p id="p"><i class="icon"></i>Hi <b>there</b></p>';
    const enc = encodeBlock(document.getElementById("p") as Element);
    expect(enc.source).toBe("Hi <x1>there</x1>");
  });
});

describe("extractBlocks", () => {
  it("extracts one block with placeholders and original slot nodes", () => {
    const blocks = extract('<p>Read the <a href="/d">docs</a> before you <b>deploy</b>.</p>');
    expect(blocks).toHaveLength(1);
    const [b] = blocks;
    expect(b?.source).toBe("Read the <x1>docs</x1> before you <x2>deploy</x2>.");
    expect(b?.slots[0]?.node).toBe(document.querySelector("a"));
    expect(b?.slots[1]?.node).toBe(document.querySelector("b"));
    expect(b?.element).toBe(document.querySelector("p"));
    expect(b?.id).toBe("b1");
    expect(document.querySelector("p")?.getAttribute(BLOCK_ID_ATTR)).toBe("b1");
  });

  it("makes each list item its own block", () => {
    const blocks = extract("<ul><li>A</li><li>B <span>C</span></li></ul>");
    expect(blocks.map((b) => b.source)).toEqual(["A", "B <x1>C</x1>"]);
  });

  it("separates direct text of a div from its child p", () => {
    const blocks = extract("<div>Intro text<p>Paragraph</p></div>");
    expect(blocks.map((b) => b.source)).toEqual(["Intro text", "Paragraph"]);
    expect(blocks[0]?.element).toBe(document.querySelector("div"));
    expect(blocks[1]?.element).toBe(document.querySelector("p"));
  });

  it("splits a container into one block per inline run, without the id attribute", () => {
    const blocks = extract("<div>One <a>two</a><p>Mid</p>Three <b>four</b></div>");
    expect(blocks.map((b) => b.source)).toEqual(["One <x1>two</x1>", "Mid", "Three <x1>four</x1>"]);
    expect(blocks[0]?.element).toBe(document.querySelector("div"));
    expect(blocks[2]?.element).toBe(document.querySelector("div"));
    expect(blocks[0]?.textNodes.map((t) => t.data)).toEqual(["One ", "two"]);
    expect(blocks[2]?.textNodes.map((t) => t.data)).toEqual(["Three ", "four"]);
    expect(new Set(blocks.map((b) => b.id)).size).toBe(3);
    expect(document.querySelector("div")?.hasAttribute(BLOCK_ID_ATTR)).toBe(false);
  });

  it("splits a container into two runs around a pre", () => {
    const blocks = extract("<div>A<pre>x</pre>B</div>");
    expect(blocks.map((b) => b.source)).toEqual(["A", "B"]);
  });

  it("skips every run of a container reported as translated, and still visits child blocks", () => {
    document.body.innerHTML = "<div>One<p>Mid</p>Two</div>";
    const div = document.querySelector("div") as Element;
    const blocks = extractBlocks(document.body, makeOpts([div]));
    expect(blocks.map((b) => [b.id, b.source])).toEqual([["b1", "Mid"]]);
    expect(div.hasAttribute(BLOCK_ID_ATTR)).toBe(false);
  });

  it("sets the id attribute on a container with exactly one run", () => {
    const blocks = extract("<div><span>Only</span> run</div>");
    expect(blocks).toHaveLength(1);
    expect(document.querySelector("div")?.getAttribute(BLOCK_ID_ATTR)).toBe(blocks[0]?.id);
  });

  it("treats a standalone link in a section as a block", () => {
    const blocks = extract('<section><a href="/x">Click here</a></section>');
    expect(blocks.map((b) => b.source)).toEqual(["<x1>Click here</x1>"]);
  });

  it("finds blocks nested inside an inline wrapper", () => {
    const blocks = extract('<div><a href="/x"><p>Card title</p></a></div>');
    expect(blocks.map((b) => b.source)).toEqual(["Card title"]);
  });

  it("skips script, style, noscript, code, pre, textarea, kbd and friends", () => {
    const blocks = extract(
      `<div><script>var a = "hello world";</script><style>p { color: red }</style>
       <noscript>Enable JS please</noscript><pre>some preformatted text</pre>
       <code>const code = 1</code><textarea>typed text here</textarea>
       <kbd>Ctrl</kbd><select><option>Option text</option></select><svg><text>svg text</text></svg></div>`,
    );
    expect(blocks).toEqual([]);
  });

  it("skips contenteditable, translate=no, .notranslate, hidden, display:none, aria-hidden", () => {
    const blocks = extract(
      `<p contenteditable>editable</p>
       <p contenteditable="true">editable true</p>
       <p translate="no">no translate</p>
       <p class="a notranslate">no class</p>
       <p hidden>hidden one</p>
       <p style="color: red; display: none">display none</p>
       <p style="visibility:hidden">visibility hidden</p>
       <p aria-hidden="true">aria hidden</p>
       <div hidden><p>inside hidden</p></div>
       <p contenteditable="false">kept text</p>`,
    );
    expect(blocks.map((b) => b.source)).toEqual(["kept text"]);
  });

  it("skips elements carrying MARK_ATTR with their descendants", () => {
    const blocks = extract(`<p>Real</p><div ${MARK_ATTR}><p>Our own translation</p></div>`);
    expect(blocks.map((b) => b.source)).toEqual(["Real"]);
  });

  it("skips text made of only digits, punctuation, URLs and emails", () => {
    for (const text of [
      "42",
      "https://x.io",
      "...",
      "(1/3)",
      "www.example.com",
      "me@example.com",
    ]) {
      expect(extract(`<p>${text}</p>`), text).toEqual([]);
    }
    expect(extract("<p>See https://x.io now</p>")).toHaveLength(1);
  });

  it("does not skip a block that only has a letter-bearing inline", () => {
    expect(extract("<p>1 <b>apple</b></p>")).toHaveLength(1);
  });

  it("extracts text inside an open shadow root", () => {
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.getElementById("host") as HTMLElement;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = "<p>Shadow text</p>";
    const blocks = extractBlocks(document.body, makeOpts());
    expect(blocks.map((b) => b.source)).toEqual(["Shadow text"]);
    expect(blocks[0]?.element).toBe(shadow.querySelector("p"));
  });

  it("accepts a ShadowRoot as root", () => {
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.getElementById("host") as HTMLElement;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = "Loose text<p>Para</p>";
    const blocks = extractBlocks(shadow, makeOpts());
    expect(blocks.map((b) => b.source)).toEqual(["Loose text", "Para"]);
    expect(blocks[0]?.element).toBe(host);
    expect(host.hasAttribute(BLOCK_ID_ATTR)).toBe(false);
  });

  it("returns nothing for a ShadowRoot whose host is inside a skipped ancestor", () => {
    document.body.innerHTML = '<div class="notranslate"><div id="host"></div></div>';
    const shadow = (document.getElementById("host") as HTMLElement).attachShadow({ mode: "open" });
    shadow.innerHTML = "<p>Hidden</p>";
    expect(extractBlocks(shadow, makeOpts())).toEqual([]);
  });

  it("ignores whitespace-only text nodes", () => {
    const blocks = extract("<ul>\n  <li>A</li>\n  <li>B</li>\n</ul>");
    expect(blocks.map((b) => b.source)).toEqual(["A", "B"]);
    expect(blocks.every((b) => b.textNodes.every((t) => t.data.trim() !== ""))).toBe(true);
  });

  it("skips blocks reported as already translated, without spending an id", () => {
    document.body.innerHTML = "<p>One</p><p>Two</p>";
    const first = document.querySelector("p") as Element;
    const blocks = extractBlocks(document.body, makeOpts([first]));
    expect(blocks.map((b) => [b.id, b.source])).toEqual([["b1", "Two"]]);
  });

  it("does not extract anything when the root sits inside a skipped ancestor", () => {
    document.body.innerHTML = '<div translate="no"><p id="p">Hello</p></div>';
    expect(extractBlocks(document.getElementById("p") as Element, makeOpts())).toEqual([]);
  });

  it("accepts a Document as root", () => {
    document.body.innerHTML = "<p>From document</p>";
    expect(extractBlocks(document, makeOpts()).map((b) => b.source)).toEqual(["From document"]);
  });
});

describe("isSkippable", () => {
  it("reports skip rules", () => {
    document.body.innerHTML =
      '<code id="a"></code><p id="b"></p><p id="c" contenteditable="false"></p><p id="d" contenteditable=""></p>';
    const get = (id: string) => document.getElementById(id) as Element;
    expect(isSkippable(get("a"))).toBe(true);
    expect(isSkippable(get("b"))).toBe(false);
    expect(isSkippable(get("c"))).toBe(false);
    expect(isSkippable(get("d"))).toBe(true);
  });
});
