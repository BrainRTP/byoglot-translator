import { afterEach, describe, expect, it, vi } from "vitest";
import { createAnimator } from "../../../../lib/dom/effects/animator";
import { availableKinds, registry } from "../../../../lib/dom/effects/registry";
import { typewriterEffect } from "../../../../lib/dom/effects/typewriter";

const CARET = "▍";

afterEach(() => {
  vi.restoreAllMocks();
});

function makeBlock(html: string): HTMLElement {
  document.body.innerHTML = html;
  const el = document.body.firstElementChild as HTMLElement;
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    top: 10,
    bottom: 50,
    left: 0,
    right: 100,
  } as DOMRect);
  return el;
}

function texts(el: Element): Text[] {
  const out: Text[] = [];
  const w = document.createTreeWalker(el, 4);
  for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n as Text);
  return out;
}

function datas(el: Element): string[] {
  return texts(el).map((t) => t.data);
}

function harness() {
  let queue: Array<() => void> = [];
  let t = 1000;
  const animator = createAnimator({
    win: window,
    quiet: (fn) => fn(),
    kind: () => "typewriter",
    raf: (cb) => {
      queue.push(cb);
    },
    now: () => t,
    random: () => {
      throw new Error("typewriter must not use random");
    },
  });
  const advance = (ms: number) => {
    t += ms;
    const run = queue;
    queue = [];
    for (const cb of run) cb();
  };
  return { animator, advance, pending: () => queue.length };
}

function replaceBlock(html: string, apply: (el: HTMLElement) => void) {
  const el = makeBlock(html);
  const h = harness();
  const token = h.animator.prepare(el);
  if (!token) throw new Error("prepare returned null");
  apply(el);
  h.animator.play(token, el);
  return { el, ...h };
}

function setAll(...values: string[]) {
  return (el: HTMLElement) => {
    texts(el).forEach((t, i) => {
      t.data = values[i] ?? "";
    });
  };
}

function bilingual(spanHtml: string) {
  const el = makeBlock("<p>Hello</p>");
  const h = harness();
  const token = h.animator.prepare(el);
  if (!token) throw new Error("prepare returned null");
  const span = document.createElement("span");
  span.innerHTML = spanHtml;
  el.append(span);
  h.animator.play(token, span);
  return { el, span, ...h };
}

// steps until the animation ends, returns the elapsed ms
function runOut(h: { advance(ms: number): void; pending(): number }, step: number): number {
  let elapsed = 0;
  while (h.pending() > 0 && elapsed < 20000) {
    h.advance(step);
    elapsed += step;
  }
  return elapsed;
}

describe("registration", () => {
  it("registers typewriter", () => {
    expect(registry.typewriter).toBe(typewriterEffect);
    expect(availableKinds()).toContain("typewriter");
  });
});

describe("first frame", () => {
  it("replace: shows the full old text, ready to be erased, no caret", () => {
    const { el } = replaceBlock("<p>Hello <b>world</b></p>", setAll("Привет ", "мир"));
    expect(datas(el)).toEqual(["Hello ", "world"]);
  });

  it("replace: new nodes with an empty `from` start empty", () => {
    const { el } = replaceBlock("<p>Hello</p>", (e) => {
      (e.firstChild as Text).data = "Привет";
      e.append(document.createTextNode(" мир"));
    });
    expect(datas(el)).toEqual(["Hello", ""]);
  });

  it("bilingual: empty strings and a caret in the first node", () => {
    const { span, el } = bilingual("Привет <b>мир</b>");
    expect(datas(span)).toEqual([CARET, ""]);
    expect(el.firstChild?.textContent).toBe("Hello");
  });
});

describe("erase", () => {
  it("erases from the end across nodes, one char per frame, caret at the end of what is left", () => {
    const { el, advance } = replaceBlock("<p>ab<i>cd</i></p>", setAll("xy", "zw"));
    const seen: string[][] = [];
    for (let i = 0; i < 4; i++) {
      advance(16);
      seen.push(datas(el));
    }
    expect(seen).toEqual([
      ["ab", `c${CARET}`],
      [`ab${CARET}`, ""],
      [`a${CARET}`, ""],
      [CARET, ""],
    ]);
  });

  it("never shows more than one char fewer than the frame before for short text", () => {
    const { el, advance, pending } = replaceBlock("<p>Hello world</p>", setAll("x"));
    let prev = (el.textContent ?? "").length;
    while (pending() > 0 && prev > 1) {
      advance(16);
      const len = (el.textContent ?? "").replace(CARET, "").length;
      expect(prev - len).toBeLessThanOrEqual(1);
      prev = len;
      if (len === 0) break;
    }
  });

  it("a 5000 char `from` is gone within 300ms", () => {
    const { el, advance } = replaceBlock(`<p>${"я".repeat(5000)}</p>`, setAll("x"));
    let elapsed = 0;
    while (el.textContent !== CARET) {
      advance(1);
      elapsed++;
      if (elapsed > 2000) throw new Error("never erased");
    }
    expect(elapsed).toBeLessThanOrEqual(300);
  });

  it("is done by 300ms even when frames are far apart", () => {
    const { el, advance } = replaceBlock(`<p>${"я".repeat(500)}</p>`, setAll("x"));
    advance(100);
    expect(el.textContent).not.toBe(CARET);
    advance(100);
    advance(100);
    expect(el.textContent).toBe(CARET);
  });
});

describe("pause", () => {
  it("holds the caret alone for 120ms, then types", () => {
    const { el, advance } = replaceBlock("<p>ab</p>", setAll("xy"));
    advance(16);
    advance(16);
    expect(el.textContent).toBe(CARET);
    // erase finished on the last frame, the pause starts there
    advance(60);
    expect(el.textContent).toBe(CARET);
    advance(59);
    expect(el.textContent).toBe(CARET);
    advance(1);
    expect(el.textContent).toBe(`x${CARET}`);
  });

  it("keeps the caret visible through the whole pause", () => {
    const { el, advance } = replaceBlock("<p>a</p>", setAll("xy"));
    advance(16);
    expect(el.textContent).toBe(CARET);
    for (let i = 0; i < 7; i++) {
      advance(16);
      expect(el.textContent).toBe(CARET);
    }
  });

  it("makes no DOM writes while nothing changes", () => {
    const { el, advance } = replaceBlock("<p>a</p>", setAll("xyz"));
    advance(16);
    const proto = Object.getPrototypeOf(texts(el)[0]) as object;
    let desc: PropertyDescriptor | undefined;
    for (let p: object | null = proto; p && !desc; p = Object.getPrototypeOf(p)) {
      desc = Object.getOwnPropertyDescriptor(p, "data");
    }
    if (!desc?.set) throw new Error("no data setter to spy on");
    const set = vi.fn(desc.set);
    Object.defineProperty(texts(el)[0] as Text, "data", { get: desc.get, set, configurable: true });
    advance(16);
    advance(16);
    advance(16);
    expect(set).not.toHaveBeenCalled();
  });
});

describe("type", () => {
  it("replace: types one char per frame with the caret at the end", () => {
    const { el, advance, pending } = replaceBlock("<p>a</p>", setAll("abcd"));
    advance(16);
    advance(200);
    const seen: string[] = [el.textContent ?? ""];
    while (pending() > 0) {
      advance(16);
      seen.push(el.textContent ?? "");
    }
    expect(seen).toEqual([`a${CARET}`, `ab${CARET}`, `abc${CARET}`, "abcd"]);
  });

  it("bilingual: no erase, pause of 120ms, then typing from the start", () => {
    const { span, advance } = bilingual("abc");
    advance(119);
    expect(span.textContent).toBe(CARET);
    advance(1);
    expect(span.textContent).toBe(`a${CARET}`);
  });

  it("goes through nodes in document order, earlier nodes final, later ones empty", () => {
    const { span, advance, pending } = bilingual("ab<i>cd</i>e");
    const seen: string[][] = [];
    advance(120);
    seen.push(datas(span));
    while (pending() > 0) {
      advance(16);
      seen.push(datas(span));
    }
    expect(seen).toEqual([
      [`a${CARET}`, "", ""],
      [`ab${CARET}`, "", ""],
      ["ab", `c${CARET}`, ""],
      ["ab", `cd${CARET}`, ""],
      ["ab", "cd", `e`],
    ]);
  });

  it("types a 5000 char block within 1400ms of the typing start, never fewer than a char per frame", () => {
    const { span, advance, pending } = bilingual("я".repeat(5000));
    advance(120);
    let typed = 1;
    let frames = 0;
    let elapsed = 0;
    while (pending() > 0) {
      advance(1);
      elapsed++;
      frames++;
      const now = (span.textContent ?? "").replace(CARET, "").length;
      expect(now).toBeGreaterThan(typed);
      typed = now;
    }
    expect(elapsed).toBeLessThanOrEqual(1400);
    expect(frames).toBeGreaterThan(1000);
    expect(span.textContent).toBe("я".repeat(5000));
  });

  it("is still done at 1400ms when frames are far apart", () => {
    const { span, advance, pending } = bilingual("я".repeat(3000));
    advance(120);
    advance(700);
    expect(span.textContent).not.toBe("я".repeat(3000));
    expect(pending()).toBe(1);
    advance(700);
    expect(pending()).toBe(0);
    expect(span.textContent).toBe("я".repeat(3000));
  });

  it("a whole replace of long text ends within 300 + 120 + 1400ms", () => {
    const h = replaceBlock(`<p>${"я".repeat(4000)}</p>`, setAll("ы".repeat(5000)));
    expect(runOut(h, 16)).toBeLessThanOrEqual(1820 + 16);
    expect(h.el.textContent).toBe("ы".repeat(5000));
  });

  it("never cuts a surrogate pair in half", () => {
    const { span, advance, pending } = bilingual("\u{1F600}x\u{1F601}\u{1F602}");
    advance(120);
    while (pending() > 0) {
      const shown = (span.textContent ?? "").replace(CARET, "");
      expect(shown).not.toMatch(
        /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/,
      );
      advance(16);
    }
    expect(span.textContent).toBe("\u{1F600}x\u{1F601}\u{1F602}");
  });

  it("types from the old text of a node that was empty before", () => {
    const { el, advance, pending } = replaceBlock("<p>Hi</p>", (e) => {
      (e.firstChild as Text).data = "Yo";
      e.append(document.createTextNode("!!"));
    });
    runOut({ advance, pending }, 16);
    expect(datas(el)).toEqual(["Yo", "!!"]);
  });
});

describe("caret", () => {
  const caretAnywhere = (el: Element) => datas(el).some((d) => d.includes(CARET));

  it("is shown while typing and gone after the last frame", () => {
    const { el, advance, pending } = replaceBlock(
      "<p>a<b>b</b><i>c</i></p>",
      setAll("xx", "yy", "zz"),
    );
    let seenCaret = false;
    while (pending() > 0) {
      advance(16);
      if (caretAnywhere(el)) seenCaret = true;
    }
    expect(seenCaret).toBe(true);
    expect(caretAnywhere(el)).toBe(false);
    expect(datas(el)).toEqual(["xx", "yy", "zz"]);
  });

  it("is in one node at a time", () => {
    const { el, advance, pending } = replaceBlock("<p>aa<b>bb</b></p>", setAll("xxx", "yyy"));
    while (pending() > 0) {
      advance(16);
      const count = datas(el).join("").split(CARET).length - 1;
      expect(count).toBeLessThanOrEqual(1);
    }
  });
});

describe("finish", () => {
  const FINAL = ["Нажмите ", "сюда", " сейчас"];
  const joined = (el: Element) => datas(el).join("");

  // each case advances until its phase is reached and checks it before finishing
  const cases: Array<[string, (el: HTMLElement, advance: (ms: number) => void) => void]> = [
    [
      "right after the first frame",
      (el) => {
        expect(datas(el)).toEqual(["Click ", "here", " now"]);
      },
    ],
    [
      "in the middle of the erase",
      (el, advance) => {
        advance(48);
        expect(joined(el).length).toBeGreaterThan(1);
        expect(joined(el).replace(CARET, "").length).toBeLessThan(14);
        expect(joined(el)).toContain(CARET);
      },
    ],
    [
      "in the pause",
      (el, advance) => {
        for (let i = 0; i < 40 && joined(el) !== CARET; i++) advance(16);
        // erase is over, the pause just began: only the caret in the first node
        expect(datas(el)).toEqual([CARET, "", ""]);
        advance(60);
        expect(datas(el)).toEqual([CARET, "", ""]);
      },
    ],
    [
      "in the middle of typing",
      (el, advance) => {
        for (let i = 0; i < 40 && joined(el) !== CARET; i++) advance(16);
        advance(120);
        advance(16);
        advance(16);
        const shown = joined(el).replace(CARET, "");
        expect(joined(el)).toContain(CARET);
        expect(shown.length).toBeGreaterThan(0);
        expect(shown.length).toBeLessThan(FINAL.join("").length);
        expect(FINAL.join("").startsWith(shown)).toBe(true);
      },
    ],
  ];
  for (const [name, reach] of cases) {
    it(`leaves \`to\` in every node and no caret: ${name}`, () => {
      const { el, animator, advance, pending } = replaceBlock(
        "<p>Click <a>here</a> now</p>",
        setAll(...FINAL),
      );
      reach(el, advance);
      animator.finishAll();
      expect(datas(el)).toEqual(FINAL);
      advance(500);
      expect(datas(el)).toEqual(FINAL);
      expect(pending()).toBe(0);
    });
  }

  it("replace with every `from` empty goes straight to the pause", () => {
    const { el, advance, pending } = replaceBlock("<p></p>", (e) => {
      e.append(document.createTextNode("ab"), document.createTextNode("cd"));
    });
    expect(datas(el)).toEqual([CARET, ""]);
    advance(119);
    expect(datas(el)).toEqual([CARET, ""]);
    advance(1);
    expect(datas(el)).toEqual([`a${CARET}`, ""]);
    runOut({ advance, pending }, 16);
    expect(datas(el)).toEqual(["ab", "cd"]);
  });

  it("bilingual: leaves `to` when stopped in the pause", () => {
    const { span, animator } = bilingual("Привет <b>мир</b>");
    animator.finishAll();
    expect(datas(span)).toEqual(["Привет ", "мир"]);
  });
});

describe("page edits", () => {
  it("stops writing a node the page changed during erase, others still finish", () => {
    const { el, advance, pending } = replaceBlock(
      "<p>Click <a>here</a></p>",
      setAll("Нажмите ", "сюда"),
    );
    const [first, second] = texts(el);
    if (!first || !second) throw new Error("nodes");
    advance(16);
    second.data = "page edit";
    runOut({ advance, pending }, 16);
    expect(second.data).toBe("page edit");
    expect(first.data).toBe("Нажмите ");
  });

  it("skips a node the page changed during typing and keeps typing the rest", () => {
    const { span, advance, pending } = bilingual("ab<i>cd</i>ef");
    const [, mid] = texts(span);
    if (!mid) throw new Error("nodes");
    advance(120);
    advance(16);
    mid.data = "page edit";
    const frames: string[] = [];
    while (pending() > 0) {
      advance(16);
      frames.push(datas(span).join("|"));
    }
    expect(mid.data).toBe("page edit");
    expect(datas(span)).toEqual(["ab", "page edit", "ef"]);
    // the skipped node costs no frames: "e" follows "ab" at once
    expect(frames[0]).toBe(`ab|page edit|e${CARET}`);
    expect(texts(span).some((t) => t.data.includes(CARET))).toBe(false);
  });

  it("a page edit of the caret node does not leave a caret behind", () => {
    const { span, advance, pending } = bilingual("abcd");
    const node = texts(span)[0] as Text;
    advance(120);
    node.data = "page";
    runOut({ advance, pending }, 16);
    expect(node.data).toBe("page");
  });

  it("when every node is touched the effect stops", () => {
    const { el, advance, pending } = replaceBlock("<p>a</p>", setAll("xyz"));
    (texts(el)[0] as Text).data = "page";
    advance(16);
    expect(pending()).toBe(0);
    expect(el.textContent).toBe("page");
  });
});
