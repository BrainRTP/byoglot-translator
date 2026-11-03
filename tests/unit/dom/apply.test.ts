import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyBilingual,
  applyReplace,
  createJournal,
  parseTranslated,
} from "../../../lib/dom/apply";
import { MARK_ATTR } from "../../../lib/dom/constants";
import { type Block, extractBlocks } from "../../../lib/dom/extract";

function blocksOf(html: string): Block[] {
  document.body.innerHTML = html;
  let i = 0;
  return extractBlocks(document.body, { isTranslated: () => false, nextId: () => `b${++i}` });
}

function firstBlock(html: string): Block {
  const block = blocksOf(html)[0];
  if (!block) throw new Error("no block");
  return block;
}

const DOCS = '<p id="p">Read the <a href="/d">docs</a> before you <b>deploy</b>.</p>';
const DOCS_RU = "Прочитайте <x1>документацию</x1> перед <x2>деплоем</x2>.";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("parseTranslated", () => {
  it("splits text and the three tag kinds", () => {
    expect(parseTranslated("a <x1>b</x1><x2/> c")).toEqual([
      { type: "text", value: "a " },
      { type: "open", n: 1 },
      { type: "text", value: "b" },
      { type: "close", n: 1 },
      { type: "self", n: 2 },
      { type: "text", value: " c" },
    ]);
  });

  it("treats any other angle bracket as text", () => {
    expect(parseTranslated("1 < 2 <x> <xa1> <x1 > </x>")).toEqual([
      { type: "text", value: "1 < 2 <x> <xa1> <x1 > </x>" },
    ]);
  });
});

describe("applyReplace", () => {
  it("keeps elements and listeners when the order is unchanged", () => {
    const block = firstBlock(DOCS);
    const a = document.querySelector("a") as HTMLAnchorElement;
    const onClick = vi.fn();
    a.addEventListener("click", onClick);
    const before = document.querySelectorAll("*").length;
    applyReplace(block, DOCS_RU, createJournal());
    expect(block.element.textContent).toBe("Прочитайте документацию перед деплоем.");
    expect(document.querySelector("a")).toBe(a);
    a.click();
    expect(onClick).toHaveBeenCalledOnce();
    expect(document.querySelectorAll("*").length).toBe(before);
  });

  it("moves the original elements when the order changes", () => {
    const block = firstBlock(DOCS);
    const a = document.querySelector("a");
    const b = document.querySelector("b");
    applyReplace(block, "Сначала <x2>деплой</x2>, потом <x1>документация</x1>.", createJournal());
    expect(block.element.textContent).toBe("Сначала деплой, потом документация.");
    expect(document.querySelector("a")).toBe(a);
    expect(document.querySelector("b")).toBe(b);
    expect(block.element.querySelectorAll("a, b").length).toBe(2);
    expect(block.element.querySelector("a")?.getAttribute("href")).toBe("/d");
  });

  it("puts the text into the first of several text nodes and empties the rest", () => {
    document.body.innerHTML = '<p id="p">Go <a id="a">x</a></p>';
    const a = document.getElementById("a") as Element;
    a.textContent = "";
    a.append("one ", "two");
    const [block] = extractBlocks(document.body, { isTranslated: () => false, nextId: () => "z" });
    expect(a.childNodes.length).toBe(2);
    applyReplace(block as Block, "Иди <x1>раз два</x1>", createJournal());
    expect(a.childNodes[0]?.nodeValue).toBe("раз два");
    expect(a.childNodes[1]?.nodeValue).toBe("");
    expect(a.parentElement?.textContent).toBe("Иди раз два");
  });

  it("keeps the br position between two text nodes of a slot", () => {
    const block = firstBlock('<p id="p"><a>one<br>two</a></p>');
    applyReplace(block, "<x1>uno<x2/>dos</x1>", createJournal());
    expect(block.element.innerHTML).toBe("<a>uno<br>dos</a>");
  });

  it("restores the exact innerHTML", () => {
    const block = firstBlock(DOCS);
    const before = block.element.innerHTML;
    const journal = createJournal();
    applyReplace(block, "Сначала <x2>деплой</x2>, потом <x1>документация</x1>.", journal);
    expect(block.element.innerHTML).not.toBe(before);
    journal.restoreAll();
    expect(block.element.innerHTML).toBe(before);
  });

  it("restores several blocks at once, in both modes", () => {
    const blocks = blocksOf(`${DOCS}<p id="q">Hello <i>there</i></p><div id="d">Plain</div>`);
    const before = document.body.innerHTML;
    const journal = createJournal();
    applyReplace(blocks[0] as Block, DOCS_RU, journal);
    applyBilingual(blocks[1] as Block, "Привет <x1>там</x1>", journal);
    applyBilingual(blocks[2] as Block, "Простой", journal);
    expect(document.body.innerHTML).not.toBe(before);
    journal.restoreAll();
    expect(document.body.innerHTML).toBe(before);
  });

  it("restores a reordered run without touching the rest of the container", () => {
    const block = blocksOf(
      '<div id="c"><p>keep</p>Hello <a href="/x">world</a> and <b>more</b></div>',
    ).find((b) => b.source.startsWith("Hello")) as Block;
    const before = document.body.innerHTML;
    const journal = createJournal();
    applyReplace(block, "Пока <x2>больше</x2> и <x1>мир</x1>", journal);
    const c = document.getElementById("c") as Element;
    expect(c.firstElementChild?.textContent).toBe("keep");
    expect(c.lastChild?.textContent).toBe("мир");
    journal.restoreAll();
    expect(document.body.innerHTML).toBe(before);
  });

  it("falls back to the first text node for an unclosed tag", () => {
    const block = firstBlock(DOCS);
    const journal = createJournal();
    expect(() => applyReplace(block, "Прочитайте <x1>документацию перед", journal)).not.toThrow();
    expect(block.textNodes[0]?.data).toBe("Прочитайте документацию перед");
    expect(block.textNodes.slice(1).every((t) => t.data === "")).toBe(true);
    journal.restoreAll();
    expect(block.element.textContent).toBe("Read the docs before you deploy.");
  });

  it("falls back for an unknown slot number and for a duplicate open", () => {
    const journal = createJournal();
    const block = firstBlock(DOCS);
    applyReplace(block, "A <x9>b</x9> <x1>c</x1>", journal);
    expect(block.element.textContent).toBe("A b c");
    const dup = firstBlock(DOCS);
    applyReplace(dup, "A <x1>b</x1> <x1>c</x1> <x2>d</x2>", journal);
    expect(dup.element.textContent).toBe("A b c d");
  });

  it("falls back when a slot is moved to another parent", () => {
    const block = firstBlock('<p id="p"><a>one <b>two</b></a> end</p>');
    applyReplace(block, "<x2>два <x1>раз</x1></x2> конец", createJournal());
    expect(block.element.textContent).toBe("два раз конец");
    expect(block.element.querySelector("a b")).not.toBeNull();
  });

  it("falls back when a placeholder is missing", () => {
    const block = firstBlock(DOCS);
    applyReplace(block, "Прочитайте <x1>документацию</x1>.", createJournal());
    expect(block.element.textContent).toBe("Прочитайте документацию.");
  });

  it("keeps self-closing slots and their content", () => {
    const block = firstBlock('<p id="p">Run <code>npm i</code> now<br>done</p>');
    const code = document.querySelector("code");
    applyReplace(block, "Запустите <x1/> сейчас<x2/>готово", createJournal());
    expect(block.element.innerHTML).toBe("Запустите <code>npm i</code> сейчас<br>готово");
    expect(document.querySelector("code")).toBe(code);
  });

  it("reorders self-closing slots", () => {
    const block = firstBlock('<p id="p">A <code>x</code> B <kbd>y</kbd> C</p>');
    applyReplace(block, "С <x2/> Б <x1/> А", createJournal());
    expect(block.element.textContent).toBe("С y Б x А");
    expect(block.element.querySelectorAll("code, kbd").length).toBe(2);
  });

  it("tolerates whitespace tokens between slots that have no text node", () => {
    const block = firstBlock('<nav id="n"><a href="/h">Home</a> <a href="/a">About</a></nav>');
    expect(block.source).toBe("<x1>Home</x1> <x2>About</x2>");
    applyReplace(block, "<x1>Домой</x1> <x2>О нас</x2>", createJournal());
    expect(block.element.textContent).toBe("Домой О нас");
    expect(block.element.childNodes.length).toBe(3);
  });

  it("does not drop translated text that has no node, and removes created nodes on restore", () => {
    const block = firstBlock('<nav id="n"><a href="/h">Home</a> <a href="/a">About</a></nav>');
    const before = block.element.innerHTML;
    const journal = createJournal();
    applyReplace(block, "<x1>Домой</x1> | <x2>О нас</x2>", journal);
    expect(block.element.textContent).toBe("Домой | О нас");
    journal.restoreAll();
    expect(block.element.innerHTML).toBe(before);
  });

  it("creates a text node when a container had none and removes it on restore", () => {
    const block = firstBlock('<p id="p">Hi <a><b>deep</b></a></p>');
    const before = block.element.innerHTML;
    const journal = createJournal();
    applyReplace(block, "Привет <x1>очень <x2>глубоко</x2></x1>", journal);
    expect(block.element.textContent).toBe("Привет очень глубоко");
    expect(block.element.querySelector("a")?.firstChild?.nodeValue).toBe("очень ");
    journal.restoreAll();
    expect(block.element.innerHTML).toBe(before);
  });

  it("keeps whitespace between reordered slots", () => {
    const block = firstBlock('<nav id="n"><a href="/h">Home</a> <a href="/a">About</a></nav>');
    const before = block.element.innerHTML;
    const journal = createJournal();
    applyReplace(block, "<x2>О нас</x2> <x1>Домой</x1>", journal);
    expect(block.element.textContent).toBe("О нас Домой");
    journal.restoreAll();
    expect(block.element.innerHTML).toBe(before);
  });

  it("only changes the run, not the rest of the container", () => {
    blocksOf('<div id="c">First <b>run</b><p>mid</p>Second <i>run</i></div>');
    const blocks = extractBlocks(document.body, { isTranslated: () => false, nextId: () => "x" });
    const second = blocks.find((b) => b.source.startsWith("Second")) as Block;
    applyReplace(second, "Второй <x1>запуск</x1>", createJournal());
    expect(document.getElementById("c")?.innerHTML).toBe(
      'First <b>run</b><p data-oct-id="x">mid</p>Второй <i>запуск</i>',
    );
  });

  it("applying twice restores the previous application first", () => {
    const block = firstBlock(DOCS);
    const before = block.element.innerHTML;
    const journal = createJournal();
    applyReplace(block, "Сначала <x2>деплой</x2>, потом <x1>документация</x1>.", journal);
    applyReplace(block, DOCS_RU, journal);
    expect(block.element.textContent).toBe("Прочитайте документацию перед деплоем.");
    journal.restoreAll();
    expect(block.element.innerHTML).toBe(before);
  });

  it("treats a stray angle bracket as text", () => {
    const block = firstBlock('<p id="p">a &lt; b</p>');
    applyReplace(block, "а < б <x7", createJournal());
    expect(block.element.textContent).toBe("а < б <x7");
  });
});

describe("journal", () => {
  it("tracks has, restore(el) and isOwnValue", () => {
    const blocks = blocksOf('<p id="a">One</p><p id="b">Two</p>');
    const [a, b] = blocks as [Block, Block];
    const journal = createJournal();
    const node = a.textNodes[0] as Text;
    expect(journal.has(a.element)).toBe(false);
    applyReplace(a, "Один", journal);
    applyReplace(b, "Два", journal);
    expect(journal.has(a.element)).toBe(true);
    expect(journal.isOwnValue(node)).toBe(true);
    node.nodeValue = "Page changed";
    expect(journal.isOwnValue(node)).toBe(false);
    node.nodeValue = "Один";
    journal.restore(a.element);
    expect(journal.has(a.element)).toBe(false);
    expect(journal.has(b.element)).toBe(true);
    expect(a.element.textContent).toBe("One");
    expect(b.element.textContent).toBe("Два");
    journal.restoreAll();
    expect(b.element.textContent).toBe("Two");
    expect(journal.has(b.element)).toBe(false);
  });
});

describe("applyBilingual", () => {
  it("adds one marked block element and leaves the original untouched", () => {
    const block = firstBlock(DOCS);
    const original = block.element.innerHTML;
    applyBilingual(block, DOCS_RU, createJournal());
    const marks = block.element.querySelectorAll(`[${MARK_ATTR}]`);
    expect(marks.length).toBe(1);
    const mark = marks[0] as HTMLElement;
    expect(mark.parentElement).toBe(block.element);
    expect(mark.textContent).toBe("Прочитайте документацию перед деплоем.");
    expect(mark.style.display).toBe("block");
    const a = mark.querySelector("a") as Element;
    expect(a.getAttribute("href")).toBe("/d");
    expect(a).not.toBe(document.querySelector("p > a"));
    expect(block.element.innerHTML.replace(mark.outerHTML, "")).toBe(original);
  });

  it("is inline and separated by a space for inline hosts", () => {
    for (const html of [
      '<button id="h">Save <b>now</b></button>',
      '<a id="h" href="/x">Save</a>',
    ]) {
      document.body.innerHTML = html;
      const host = document.getElementById("h") as Element;
      const block = extractBlocks(host, {
        isTranslated: () => false,
        nextId: () => "h",
      })[0] as Block;
      expect(block.element).toBe(host);
      const ru = html.includes("<b>") ? "Сохранить <x1>сейчас</x1>" : "Сохранить";
      applyBilingual(block, ru, createJournal());
      const mark = block.element.querySelector(`[${MARK_ATTR}]`) as HTMLElement;
      expect(mark.style.display).not.toBe("block");
      expect(mark.previousSibling?.nodeValue).toBe(" ");
    }
  });

  it("clones self-closing slots deeply", () => {
    const block = firstBlock('<p id="p">Run <code>npm i</code> now</p>');
    applyBilingual(block, "Запустите <x1/> сейчас", createJournal());
    const mark = block.element.querySelector(`[${MARK_ATTR}]`) as Element;
    expect(mark.innerHTML).toBe("Запустите <code>npm i</code> сейчас");
  });

  it("inserts right after the run, not at the end of the container", () => {
    const blocks = blocksOf('<div id="c">First <b>run</b><p>mid</p>Second <i>run</i> tail</div>');
    const first = blocks.find((b) => b.source.startsWith("First")) as Block;
    applyBilingual(first, "Первый <x1>запуск</x1>", createJournal());
    const c = document.getElementById("c") as Element;
    const mark = c.querySelector(`[${MARK_ATTR}]`) as Element;
    expect(mark.previousSibling).toBe(c.querySelector("b"));
    expect(mark.nextSibling).toBe(c.querySelector("p"));
  });

  it("strips tags in the bilingual fallback and never throws", () => {
    const block = firstBlock(DOCS);
    expect(() => applyBilingual(block, "Привет <x1>мир", createJournal())).not.toThrow();
    expect(block.element.querySelector(`[${MARK_ATTR}]`)?.textContent).toBe("Привет мир");
  });

  it("applying twice leaves one element", () => {
    const block = firstBlock(DOCS);
    const journal = createJournal();
    applyBilingual(block, DOCS_RU, journal);
    applyBilingual(block, DOCS_RU, journal);
    expect(block.element.querySelectorAll(`[${MARK_ATTR}]`).length).toBe(1);
    journal.restoreAll();
    expect(block.element.querySelectorAll(`[${MARK_ATTR}]`).length).toBe(0);
  });
});

describe("journal resilience", () => {
  const RU_RUN = "Второй <x1>запуск</x1>";

  it("re-applying one run keeps a sibling run in the same container translated", () => {
    const blocks = blocksOf('<div id="c">First <b>run</b><p>mid</p>Second <i>run</i></div>');
    const before = document.body.innerHTML;
    const first = blocks.find((b) => b.source.startsWith("First")) as Block;
    const second = blocks.find((b) => b.source.startsWith("Second")) as Block;
    const journal = createJournal();
    applyReplace(first, "Первый <x1>запуск</x1>", journal);
    applyReplace(second, RU_RUN, journal);
    expect(journal.hasBlock(first)).toBe(true);
    applyReplace(first, "Первый <x1>прогон</x1>", journal);
    const c = document.getElementById("c") as Element;
    expect(c.textContent).toBe("Первый прогонmidВторой запуск");
    expect(journal.hasBlock(second)).toBe(true);
    journal.restoreBlock(first);
    expect(journal.hasBlock(first)).toBe(false);
    expect(journal.hasBlock(second)).toBe(true);
    expect(c.lastChild?.textContent).toBe("запуск");
    applyReplace(first, "Первый <x1>запуск</x1>", journal);
    journal.restoreAll();
    expect(document.body.innerHTML).toBe(before);
  });

  it("restoreAll survives a recorded text node removed by the page", () => {
    const block = firstBlock(DOCS);
    const journal = createJournal();
    applyReplace(block, DOCS_RU, journal);
    (block.textNodes[2] as Text).remove();
    expect(() => journal.restoreAll()).not.toThrow();
    expect(block.element.textContent).toBe("Read the docsdeploy.");
  });

  it("restoreAll survives a created text node removed by the page", () => {
    const block = firstBlock('<p id="p">Hi <a><b>deep</b></a></p>');
    const before = block.element.innerHTML;
    const journal = createJournal();
    applyReplace(block, "Привет <x1>очень <x2>глубоко</x2></x1>", journal);
    const created = block.element.querySelector("a")?.firstChild as Node;
    expect(created.nodeValue).toBe("очень ");
    created.parentNode?.removeChild(created);
    expect(() => journal.restoreAll()).not.toThrow();
    expect(block.element.innerHTML).toBe(before);
  });

  it("restores a reordered run before the next surviving sibling when the anchor is gone", () => {
    const block = blocksOf(
      '<div id="c"><p>blk</p>Hello <a href="/x">world</a> and <b>more</b><p>one</p><section>two</section></div>',
    ).find((b) => b.source.startsWith("Hello")) as Block;
    const c = document.getElementById("c") as Element;
    const journal = createJournal();
    applyReplace(block, "Пока <x2>больше</x2> и <x1>мир</x1>", journal);
    c.querySelector("p:last-of-type")?.remove();
    expect(() => journal.restoreAll()).not.toThrow();
    expect(c.lastElementChild?.localName).toBe("section");
    expect(c.querySelector("section")?.previousSibling?.textContent).toBe("more");
    expect(c.textContent).toBe("blkHello world and moretwo");
  });

  it("falls back after an exception during apply and stays restorable", () => {
    const block = firstBlock(DOCS);
    const before = block.element.innerHTML;
    const node = block.textNodes[1] as Text;
    let desc: PropertyDescriptor | undefined;
    for (let o: object | null = node; o && !desc; o = Object.getPrototypeOf(o)) {
      desc = Object.getOwnPropertyDescriptor(o, "nodeValue");
    }
    const real = desc as PropertyDescriptor;
    let calls = 0;
    Object.defineProperty(node, "nodeValue", {
      configurable: true,
      get: () => real.get?.call(node),
      set: (v: string) => {
        if (calls++ === 0) throw new Error("boom");
        real.set?.call(node, v);
      },
    });
    const journal = createJournal();
    expect(() => applyReplace(block, DOCS_RU, journal)).not.toThrow();
    expect(block.textNodes[0]?.data).toBe("Прочитайте документацию перед деплоем.");
    journal.restoreAll();
    expect(block.element.innerHTML).toBe(before);
  });

  it("a failing undo does not abort the rest of restoreAll", () => {
    const blocks = blocksOf('<p id="a">One</p><p id="b">Two</p>');
    const [a, b] = blocks as [Block, Block];
    const journal = createJournal();
    applyReplace(a, "Один", journal);
    applyReplace(b, "Два", journal);
    const node = b.textNodes[0] as Text;
    Object.defineProperty(node, "nodeValue", {
      configurable: true,
      get: () => "x",
      set: () => {
        throw new Error("undo boom");
      },
    });
    expect(() => journal.restoreAll()).not.toThrow();
    expect(a.element.textContent).toBe("One");
  });
});
