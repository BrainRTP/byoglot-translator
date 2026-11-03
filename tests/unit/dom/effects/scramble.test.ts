import { afterEach, describe, expect, it, vi } from "vitest";
import { createAnimator } from "../../../../lib/dom/effects/animator";
import { availableKinds, registry } from "../../../../lib/dom/effects/registry";
import { scrambleEffect } from "../../../../lib/dom/effects/scramble";

const SYMBOLS = "#%&*+=?@$";
const LATIN_UP = /^[A-Z]$/;
const LATIN_LOW = /^[a-z]$/;
const CYR_UP = /^[А-Я]$/;
const CYR_LOW = /^[а-я]$/;

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

function lcg(seed = 12345) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function harness(random: () => number = lcg()) {
  let queue: Array<() => void> = [];
  let t = 1000;
  const animator = createAnimator({
    win: window,
    quiet: (fn) => fn(),
    kind: () => "scramble",
    raf: (cb) => {
      queue.push(cb);
    },
    now: () => t,
    random,
  });
  const advance = (ms: number) => {
    t += ms;
    const run = queue;
    queue = [];
    for (const cb of run) cb();
  };
  return { animator, advance, pending: () => queue.length };
}

function replaceBlock(
  html: string,
  apply: (el: HTMLElement) => void,
  random: () => number = lcg(),
) {
  const el = makeBlock(html);
  const h = harness(random);
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

describe("registration", () => {
  it("registers scramble", () => {
    expect(registry.scramble).toBe(scrambleEffect);
    expect(availableKinds()).toContain("scramble");
  });
});

describe("first frame", () => {
  it("writes a scrambled frame right after apply, never the old or the final text", () => {
    const { el } = replaceBlock("<p>Hello</p>", setFirst("Привет"));
    const text = el.textContent ?? "";
    expect(text).not.toBe("Hello");
    expect(text).not.toBe("Привет");
    expect(text).toHaveLength("Привет".length);
  });

  it("keeps the string length equal to `to` in every frame", () => {
    const to = "Это длинная строка, 123 слова!";
    const { el, advance, pending } = replaceBlock("<p>Hello</p>", setFirst(to));
    expect(el.textContent).toHaveLength(to.length);
    while (pending() > 0) {
      advance(16);
      expect(el.textContent).toHaveLength(to.length);
    }
    expect(el.textContent).toBe(to);
  });

  it("keeps spaces and newlines in place in every frame", () => {
    const to = "Раз два\nтри  four\tfive";
    const { el, advance, pending } = replaceBlock("<p>Hello</p>", setFirst(to));
    const check = () => {
      const text = el.textContent ?? "";
      for (let i = 0; i < to.length; i++) {
        if (/\s/.test(to[i] ?? "")) expect(text[i]).toBe(to[i]);
        else expect(/\s/.test(text[i] ?? "")).toBe(false);
      }
    };
    check();
    while (pending() > 0) {
      advance(40);
      check();
    }
  });
});

describe("glyph sets", () => {
  function collect(to: string) {
    const { el, advance, pending } = replaceBlock("<p>x</p>", setFirst(to));
    const frames: string[] = [el.textContent ?? ""];
    while (pending() > 0) {
      advance(40);
      frames.push(el.textContent ?? "");
    }
    return frames;
  }

  it("uses Latin glyphs for Latin targets and keeps case", () => {
    const frames = collect("HELLOworld".repeat(10));
    const to = "HELLOworld".repeat(10);
    for (const f of frames) {
      for (let i = 0; i < to.length; i++) {
        if (f[i] === to[i]) continue;
        expect(f[i]).toMatch(/[A-Z]/.test(to[i] ?? "") ? LATIN_UP : LATIN_LOW);
      }
    }
  });

  it("uses Cyrillic glyphs for Cyrillic targets, keeps case, never emits yo", () => {
    const to = "ПРИВЕТмир".repeat(10);
    const frames = collect(to);
    let scrambled = 0;
    for (const f of frames) {
      expect(f).not.toMatch(/[\u0451\u0401]/);
      for (let i = 0; i < to.length; i++) {
        if (f[i] === to[i]) continue;
        scrambled++;
        expect(f[i]).toMatch(/[А-Я]/.test(to[i] ?? "") ? CYR_UP : CYR_LOW);
      }
    }
    expect(scrambled).toBeGreaterThan(0);
  });

  it("uses digits for digit targets", () => {
    const to = "1234567890".repeat(10);
    for (const f of collect(to)) expect(f).toMatch(/^[0-9]+$/);
  });

  it("uses the symbol set for everything else", () => {
    const to = "日本語、中文!?".repeat(10);
    const frames = collect(to);
    let scrambled = 0;
    for (const f of frames) {
      for (let i = 0; i < to.length; i++) {
        if (f[i] === to[i]) continue;
        scrambled++;
        expect(SYMBOLS).toContain(f[i] ?? "?!");
      }
    }
    expect(scrambled).toBeGreaterThan(0);
  });

  it("covers every glyph of each set across frames", () => {
    const seen = new Set<string>();
    for (const f of collect("a".repeat(200))) for (const ch of f) seen.add(ch);
    expect(seen.size).toBe(26);
    const upper = new Set<string>();
    for (const f of collect("Я".repeat(200))) for (const ch of f) upper.add(ch);
    expect(upper.size).toBe(32);
  });
});

describe("timing", () => {
  it("throttles frames to one per 40ms", () => {
    let n = 0;
    const random = () => ((n++ * 0.6180339) % 1) * 0.5 + 0.2;
    const { el, advance } = replaceBlock("<p>x</p>", setFirst("Привет, мир".repeat(5)), random);
    const first = el.textContent;
    advance(16);
    advance(16);
    expect(el.textContent).toBe(first);
    advance(8);
    const second = el.textContent;
    expect(second).not.toBe(first);
    advance(39);
    expect(el.textContent).toBe(second);
    advance(1);
    expect(el.textContent).not.toBe(second);
  });

  // random() close to 1 gives settle times close to D
  const late = () => 0.9999;

  it.each([
    [5, 600],
    [100, 1000],
    [200, 1600],
    [300, 1800],
    [5000, 1800],
  ])("a %i char block lasts D = %i ms", (chars, d) => {
    const { el, advance, pending } = replaceBlock("<p>x</p>", setFirst("б".repeat(chars)), late);
    advance(d - 1);
    expect(pending()).toBe(1);
    expect(el.textContent).not.toBe("б".repeat(chars));
    advance(1);
    expect(pending()).toBe(0);
    expect(el.textContent).toBe("б".repeat(chars));
  });

  it("finishes at D even when the frame arrives late", () => {
    const { el, advance, pending } = replaceBlock("<p>x</p>", setFirst("Привет"), late);
    advance(5000);
    expect(pending()).toBe(0);
    expect(el.textContent).toBe("Привет");
  });

  it("nothing settles before 0.15 D", () => {
    const early = () => 0;
    const to = "б".repeat(100);
    const { el, advance } = replaceBlock("<p>x</p>", setFirst(to), early);
    advance(0.15 * 1000 - 1);
    // D = 1000, every position settles exactly at 150
    expect(el.textContent).not.toBe(to);
    // the next throttled frame shows the settled text
    advance(40);
    expect(el.textContent).toBe(to);
  });

  it("settles positions one by one between 0.15 D and D", () => {
    const to = "б".repeat(100);
    const { el, advance } = replaceBlock("<p>x</p>", setFirst(to));
    const settled = (): number => [...(el.textContent ?? "")].filter((c) => c === "б").length;
    advance(400);
    const mid = settled();
    advance(400);
    const later = settled();
    expect(mid).toBeGreaterThan(0);
    expect(later).toBeGreaterThan(mid);
    expect(later).toBeLessThan(100);
  });
});

describe("several text nodes", () => {
  it("uses document order for the settle times and keeps each node's own text", () => {
    // first 6 draws (node 1) settle late, next 3 (node 2) settle at 0.15 D, glyph draws after that
    let n = 0;
    const random = () => (n++ < 6 ? 0.9999 : n <= 9 ? 0 : 0.5);
    const { el, advance } = replaceBlock(
      "<p>Click <a>here</a></p>",
      (e) => {
        const [a, b] = texts(e);
        if (!a || !b) throw new Error("nodes");
        a.data = "Привет";
        b.data = "мир";
      },
      random,
    );
    const [first, second] = texts(el);
    if (!first || !second) throw new Error("nodes");
    expect(first.data).toHaveLength(6);
    expect(second.data).toHaveLength(3);
    advance(200);
    expect(second.data).toBe("мир");
    expect(first.data).not.toBe("Привет");
    expect(first.data).toHaveLength(6);
    advance(2000);
    expect(texts(el).map((t) => t.data)).toEqual(["Привет", "мир"]);
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
    advance(40);
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
    advance(40);
    expect(second.data).toBe("page edit");
    expect(first.data).toHaveLength(8);
    advance(2000);
    expect(pending()).toBe(0);
    expect(second.data).toBe("page edit");
    expect(first.data).toBe("Нажмите ");
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

  it("scrambles the inserted text from the first frame without an old-text phase", () => {
    const { el, span, advance, pending } = bilingual();
    expect(span.textContent).not.toBe("Привет");
    expect(span.textContent).toHaveLength(6);
    expect(el.firstChild?.textContent).toBe("Hello");
    while (pending() > 0) advance(40);
    expect(span.textContent).toBe("Привет");
  });
});
