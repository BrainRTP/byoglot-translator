import { afterEach, describe, expect, it, vi } from "vitest";
import { createAnimator } from "../../../../lib/dom/effects/animator";
import { flapEffect } from "../../../../lib/dom/effects/flap";
import { availableKinds, registry } from "../../../../lib/dom/effects/registry";

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

function harness() {
  let queue: Array<() => void> = [];
  let t = 1000;
  const animator = createAnimator({
    win: window,
    quiet: (fn) => fn(),
    kind: () => "flap",
    raf: (cb) => {
      queue.push(cb);
    },
    now: () => t,
    random: () => {
      throw new Error("flap must not use random");
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

function setFirst(value: string) {
  return (el: HTMLElement) => {
    (el.firstChild as Text).data = value;
  };
}

// text frames of a single-text-node block, sampled every `stepMs` until the animation ends
function frames(from: string, to: string, stepMs = 45): string[] {
  const { el, advance, pending } = replaceBlock(`<p>${from}</p>`, setFirst(to));
  const out = [el.textContent ?? ""];
  while (pending() > 0) {
    advance(stepMs);
    out.push(el.textContent ?? "");
  }
  return out;
}

// distinct consecutive values, so repeated frames do not count as steps
function steps(list: string[]): string[] {
  return list.filter((v, i) => i === 0 || v !== list[i - 1]);
}

describe("registration", () => {
  it("registers flap", () => {
    expect(registry.flap).toBe(flapEffect);
    expect(availableKinds()).toContain("flap");
  });
});

describe("one position", () => {
  it("flips through the set one glyph per 45ms and ends on the target", () => {
    const { el, advance, pending } = replaceBlock("<p>A</p>", setFirst("E"));
    expect(el.textContent).toBe("A");
    advance(44);
    expect(el.textContent).toBe("A");
    advance(1);
    expect(el.textContent).toBe("B");
    advance(44);
    expect(el.textContent).toBe("B");
    advance(1);
    expect(el.textContent).toBe("C");
    advance(45);
    expect(el.textContent).toBe("D");
    advance(45);
    expect(el.textContent).toBe("E");
    expect(pending()).toBe(0);
  });

  it("writes the first frame right after apply: the source glyph, not the final text", () => {
    const { el } = replaceBlock("<p>B</p>", setFirst("F"));
    expect(el.textContent).toBe("B");
  });

  it("jumps ahead when the distance is above 10 so exactly 10 flips remain", () => {
    // A is index 1, N is index 14, distance 13
    const seq = steps(frames("A", "N"));
    expect(seq).toEqual(["A", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N"]);
    expect(seq.length - 1).toBe(10);
  });

  it("does not jump when the distance is exactly 10", () => {
    expect(steps(frames("A", "K"))).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
      "G",
      "H",
      "I",
      "J",
      "K",
    ]);
  });

  it("wraps around the end of the set through the blank", () => {
    // ? - blank A
    expect(steps(frames("?", "A"))).toEqual(["?", "-", " ", "A"]);
  });

  it("flips Cyrillic in set order", () => {
    expect(steps(frames("А", "Г"))).toEqual(["А", "Б", "В", "Г"]);
  });

  it("flips digits in set order", () => {
    expect(steps(frames("1", "4"))).toEqual(["1", "2", "3", "4"]);
  });

  it("flips punctuation in set order", () => {
    expect(steps(frames(".", ";"))).toEqual([".", ",", ":", ";"]);
  });
});

describe("case", () => {
  it("compares case-insensitively: the same letter in another case is placed at once", () => {
    const { el, pending, advance } = replaceBlock("<p>c</p>", setFirst("C"));
    expect(el.textContent).toBe("C");
    advance(45);
    expect(pending()).toBe(0);
    expect(el.textContent).toBe("C");
  });

  it("applies the target case to every shown glyph, lower", () => {
    expect(steps(frames("A", "d"))).toEqual(["a", "b", "c", "d"]);
  });

  it("applies the target case to every shown glyph, upper, ignoring the source case", () => {
    expect(steps(frames("a", "D"))).toEqual(["A", "B", "C", "D"]);
  });

  it("applies the target case to Cyrillic", () => {
    expect(steps(frames("а", "Г"))).toEqual(["А", "Б", "В", "Г"]);
    expect(steps(frames("А", "г"))).toEqual(["а", "б", "в", "г"]);
  });

  it("never shows yo and keeps the final text exact", () => {
    const to = "Привет мир";
    for (const f of frames("Hello", to.repeat(5), 15)) expect(f).not.toMatch(/[\u0451\u0401]/);
  });
});

describe("chars outside the set", () => {
  it("places them target from the first frame and keeps them in every frame", () => {
    const to = "a#b\nc中\u0451d";
    const all = frames("xxxxxxxxx", to, 15);
    const fixed = [1, 3, 5, 6];
    for (const f of all) {
      expect(f).toHaveLength(to.length);
      for (const i of fixed) expect(f[i]).toBe(to[i]);
    }
    expect(all.at(-1)).toBe(to);
  });

  it("keeps every whitespace position of `to` whitespace in every frame, even over old letters", () => {
    const to = "Раз два\nтри\u00a0four\tfive  six";
    const all = frames("Z".repeat(to.length), to, 5);
    expect(all[0]).toHaveLength(to.length);
    for (const f of all) {
      expect(f).toHaveLength(to.length);
      for (let i = 0; i < to.length; i++) {
        if (/\s/.test(to[i] as string)) expect(f[i]).toBe(to[i]);
      }
    }
    expect(all.at(-1)).toBe(to);
  });

  it("still flips a letter that starts from an old space", () => {
    expect(steps(frames(" ", "C"))).toEqual([" ", "A", "B", "C"]);
  });

  it("treats a source outside the set as a blank", () => {
    expect(steps(frames("%", "C"))).toEqual([" ", "A", "B", "C"]);
  });

  it("does not move a position whose source and target are both outside the set", () => {
    const all = frames("%", "#");
    expect(all[0]).toBe("#");
    expect(steps(all)).toEqual(["#"]);
  });
});

describe("source text", () => {
  it("starts from the old text char by char", () => {
    const { el } = replaceBlock("<p>Hello</p>", setFirst("Hexxo"));
    expect(el.textContent).toBe("Hello");
  });

  it("pads a short source with blanks", () => {
    const { el } = replaceBlock("<p>AB</p>", setFirst("ABCD"));
    expect(el.textContent).toBe("AB  ");
  });

  it("truncates a long source to the length of `to`", () => {
    const { el } = replaceBlock("<p>ABCDEFGH</p>", setFirst("ABCx"));
    expect(el.textContent).toHaveLength(4);
    expect(el.textContent?.slice(0, 3)).toBe("ABC");
  });

  it("keeps the string length equal to `to` in every frame", () => {
    const to = "Это длинная строка, 123 слова!";
    for (const f of frames("Hello", to, 7)) expect(f).toHaveLength(to.length);
  });

  it("never shows more than 10 different glyphs per position after the source", () => {
    const to = "Это длинная строка, 123 слова! ABC xyz".repeat(3);
    const all = frames("Z".repeat(to.length), to, 5);
    for (let i = 0; i < to.length; i++) {
      const column = steps(all.map((f) => f[i] ?? ""));
      expect(column.length - 1).toBeLessThanOrEqual(10);
    }
    expect(all.at(-1)).toBe(to);
  });
});

describe("stagger", () => {
  it("starts positions 12ms apart, left to right", () => {
    // blank to A is one flip, so each position changes 45ms after its own start
    const { el, advance } = replaceBlock("<p>   </p>", setFirst("AAA"));
    expect(el.textContent).toBe("   ");
    advance(44);
    expect(el.textContent).toBe("   ");
    advance(1);
    expect(el.textContent).toBe("A  ");
    advance(11);
    expect(el.textContent).toBe("A  ");
    advance(1);
    expect(el.textContent).toBe("AA ");
    advance(11);
    expect(el.textContent).toBe("AA ");
    advance(1);
    expect(el.textContent).toBe("AAA");
  });

  it("shrinks the stagger so a 2000 char block ends within 1600ms", () => {
    const to = "Я".repeat(2000);
    const { el, advance, pending } = replaceBlock("<p>x</p>", setFirst(to));
    advance(1599);
    expect(pending()).toBe(1);
    expect(el.textContent).not.toBe(to);
    advance(1);
    expect(pending()).toBe(0);
    expect(el.textContent).toBe(to);
  });

  it("a 5000 char block does not exceed 1600ms either", () => {
    const to = "Ы".repeat(5000);
    const { el, advance, pending } = replaceBlock("<p>x</p>", setFirst(to));
    advance(1600);
    expect(pending()).toBe(0);
    expect(el.textContent).toBe(to);
  });

  it("a short block ends at stagger plus 10 steps", () => {
    const to = "Я".repeat(10);
    const { el, advance, pending } = replaceBlock("<p>x</p>", setFirst(to));
    // last position starts at 9 * 12 = 108 and flips for 450ms
    advance(108 + 450 - 1);
    expect(pending()).toBe(1);
    expect(el.textContent).not.toBe(to);
    advance(1);
    expect(pending()).toBe(0);
    expect(el.textContent).toBe(to);
  });

  it("finishes at the end even when the frame arrives late", () => {
    const { el, advance, pending } = replaceBlock("<p>Hello</p>", setFirst("Привет"));
    advance(5000);
    expect(pending()).toBe(0);
    expect(el.textContent).toBe("Привет");
  });

  it("ends at once when nothing needs flipping", () => {
    const { el, advance, pending } = replaceBlock("<p>a#</p>", setFirst("A#"));
    expect(el.textContent).toBe("A#");
    advance(1);
    expect(pending()).toBe(0);
    expect(el.textContent).toBe("A#");
  });
});

describe("several text nodes", () => {
  it("staggers across nodes in document order and keeps each node's own text", () => {
    const { el, advance } = replaceBlock("<p>  <a>  </a></p>", (e) => {
      const [a, b] = texts(e);
      if (!a || !b) throw new Error("nodes");
      a.data = "AA";
      b.data = "AA";
    });
    const [first, second] = texts(el);
    if (!first || !second) throw new Error("nodes");
    expect([first.data, second.data]).toEqual(["  ", "  "]);
    // positions start at 0, 12, 24, 36 and flip once, 45ms later
    advance(57);
    expect([first.data, second.data]).toEqual(["AA", "  "]);
    advance(12);
    expect([first.data, second.data]).toEqual(["AA", "A "]);
    advance(12);
    expect([first.data, second.data]).toEqual(["AA", "AA"]);
  });

  it("flips each node from its own old text", () => {
    const { el } = replaceBlock("<p>Click <a>here</a></p>", (e) => {
      const [a, b] = texts(e);
      if (!a || !b) throw new Error("nodes");
      a.data = "Нажмите";
      b.data = "сюда";
    });
    expect(texts(el).map((t) => t.data)).toEqual(["Click  ", "here"]);
  });
});

describe("bilingual", () => {
  function bilingual() {
    const el = makeBlock("<p>Hello</p>");
    const h = harness();
    const token = h.animator.prepare(el);
    if (!token) throw new Error("prepare returned null");
    const span = document.createElement("span");
    span.textContent = "Привет";
    el.append(span);
    h.animator.play(token, span);
    return { el, span, ...h };
  }

  it("flips the inserted text from blanks, no old-text phase", () => {
    const { el, span, advance, pending } = bilingual();
    expect(span.textContent).toBe("      ");
    expect(el.firstChild?.textContent).toBe("Hello");
    while (pending() > 0) advance(40);
    expect(span.textContent).toBe("Привет");
    expect(el.firstChild?.textContent).toBe("Hello");
  });
});

describe("finish", () => {
  it("leaves `to` in every node when stopped in the middle", () => {
    const { el, animator, advance, pending } = replaceBlock("<p>Click <a>here</a> now</p>", (e) => {
      const [a, b, c] = texts(e);
      if (!a || !b || !c) throw new Error("nodes");
      a.data = "Нажмите ";
      b.data = "сюда";
      c.data = " сейчас";
    });
    advance(200);
    expect(el.textContent).not.toBe("Нажмите сюда сейчас");
    animator.finishAll();
    expect(texts(el).map((t) => t.data)).toEqual(["Нажмите ", "сюда", " сейчас"]);
    advance(45);
    expect(texts(el).map((t) => t.data)).toEqual(["Нажмите ", "сюда", " сейчас"]);
    expect(pending()).toBe(0);
  });

  it("leaves `to` when stopped right after the first frame", () => {
    const { el, animator } = replaceBlock("<p>Hello</p>", setFirst("Привет"));
    animator.finishAll();
    expect(el.textContent).toBe("Привет");
  });
});

describe("page edits", () => {
  it("stops writing a node the page changed and keeps animating the others", () => {
    const { el, advance, pending } = replaceBlock("<p>Click <a>here</a></p>", (e) => {
      const [a, b] = texts(e);
      if (!a || !b) throw new Error("nodes");
      a.data = "Нажмите ";
      b.data = "сюда";
    });
    const [first, second] = texts(el);
    if (!first || !second) throw new Error("nodes");
    second.data = "page edit";
    advance(100);
    expect(second.data).toBe("page edit");
    expect(first.data).toHaveLength(8);
    expect(first.data).not.toBe("Нажмите ");
    advance(2000);
    expect(pending()).toBe(0);
    expect(second.data).toBe("page edit");
    expect(first.data).toBe("Нажмите ");
  });
});
