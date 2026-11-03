import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAnimator } from "../../../../lib/dom/effects/animator";
import { fadeEffect } from "../../../../lib/dom/effects/fade";
import { availableKinds, registry } from "../../../../lib/dom/effects/registry";

type Anim = {
  cancel: ReturnType<typeof vi.fn>;
  finished: Promise<unknown>;
  onfinish: null;
};

let anims: Anim[];
let animateSpy: ReturnType<typeof vi.fn>;
let savedAnimate: unknown;

beforeEach(() => {
  anims = [];
  savedAnimate = (Element.prototype as { animate?: unknown }).animate;
  animateSpy = vi.fn(() => {
    const a: Anim = { cancel: vi.fn(), finished: Promise.resolve(), onfinish: null };
    anims.push(a);
    return a;
  });
  (Element.prototype as { animate?: unknown }).animate = animateSpy;
});

afterEach(() => {
  (Element.prototype as { animate?: unknown }).animate = savedAnimate;
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
    kind: () => "fade",
    raf: (cb) => {
      queue.push(cb);
    },
    now: () => t,
    random: () => 0.5,
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

describe("registration", () => {
  it("registers fade", () => {
    expect(registry.fade).toBe(fadeEffect);
    expect(availableKinds()).toContain("fade");
  });
});

describe("replace mode", () => {
  const swap = (el: HTMLElement) => {
    (el.firstChild as Text).data = "Привет";
  };

  it("shows the old text on the first write and fades it out over 180ms", () => {
    const { el } = replaceBlock("<p>Hello</p>", swap);
    expect(el.textContent).toBe("Hello");
    expect(animateSpy).toHaveBeenCalledTimes(1);
    expect(animateSpy).toHaveBeenCalledWith([{ opacity: 1 }, { opacity: 0 }], {
      duration: 180,
      easing: "ease-in",
      fill: "forwards",
    });
  });

  it("keeps the old text until 180ms and one frame pass, then writes the new one and fades in over 320ms", () => {
    const { el, advance } = replaceBlock("<p>Hello</p>", swap);
    advance(100);
    expect(el.textContent).toBe("Hello");
    expect(animateSpy).toHaveBeenCalledTimes(1);
    advance(80);
    expect(el.textContent).toBe("Hello");
    expect(animateSpy).toHaveBeenCalledTimes(1);
    advance(16);
    expect(el.textContent).toBe("Привет");
    expect(animateSpy).toHaveBeenCalledTimes(2);
    expect(animateSpy).toHaveBeenLastCalledWith([{ opacity: 0 }, { opacity: 1 }], {
      duration: 320,
      easing: "ease-out",
      fill: "forwards",
    });
  });

  it("ends one frame after the second phase should end and cancels both animations", () => {
    const { el, advance, pending } = replaceBlock("<p>Hello</p>", swap);
    advance(196);
    advance(320);
    expect(anims.every((a) => a.cancel.mock.calls.length === 0)).toBe(true);
    expect(pending()).toBe(1);
    advance(16);
    expect(el.textContent).toBe("Привет");
    expect(pending()).toBe(0);
    expect(anims).toHaveLength(2);
    for (const a of anims) expect(a.cancel).toHaveBeenCalled();
  });

  it("takes the same time for a 5000 character block", () => {
    const long = "a".repeat(5000);
    const { el, advance, pending } = replaceBlock(`<p>${long}</p>`, (e) => {
      (e.firstChild as Text).data = "b".repeat(5000);
    });
    advance(196);
    advance(336);
    expect(pending()).toBe(0);
    expect(el.textContent).toBe("b".repeat(5000));
  });

  it("handles several text nodes in document order without mixing them", () => {
    const { el, advance } = replaceBlock("<p>Click <a>here</a> now</p>", (e) => {
      const [a, b, c] = texts(e);
      if (!a || !b || !c) throw new Error("nodes");
      a.data = "Нажмите ";
      b.data = "сюда";
      c.data = " сейчас";
    });
    expect(texts(el).map((n) => n.data)).toEqual(["Click ", "here", " now"]);
    advance(196);
    expect(texts(el).map((n) => n.data)).toEqual(["Нажмите ", "сюда", " сейчас"]);
  });

  it("finish in the middle of the fade out leaves the new text and cancels", () => {
    const { el, animator, advance } = replaceBlock("<p>Hello</p>", swap);
    advance(50);
    animator.finishAll();
    expect(el.textContent).toBe("Привет");
    expect(anims[0]?.cancel).toHaveBeenCalled();
  });

  it("finish in the middle of the fade in leaves the new text and cancels both", () => {
    const { el, animator, advance } = replaceBlock("<p>Hello</p>", swap);
    advance(180);
    advance(100);
    animator.finishAll();
    expect(el.textContent).toBe("Привет");
    expect(anims).toHaveLength(2);
    for (const a of anims) expect(a.cancel).toHaveBeenCalled();
  });

  it("stops writing a node the page changed during the fade out", () => {
    const { el, advance } = replaceBlock("<p>Click <a>here</a></p>", (e) => {
      const [a, b] = texts(e);
      if (!a || !b) throw new Error("nodes");
      a.data = "Нажмите ";
      b.data = "сюда";
    });
    const [first, second] = texts(el);
    if (!first || !second) throw new Error("nodes");
    second.data = "page edit";
    advance(196);
    expect(first.data).toBe("Нажмите ");
    expect(second.data).toBe("page edit");
    advance(336);
    expect(second.data).toBe("page edit");
  });

  it("works when the page has no Element.animate", () => {
    (Element.prototype as { animate?: unknown }).animate = undefined;
    const { el, advance, pending } = replaceBlock("<p>Hello</p>", swap);
    expect(el.textContent).toBe("Hello");
    advance(196);
    expect(el.textContent).toBe("Привет");
    advance(336);
    expect(pending()).toBe(0);
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

  it("never writes the empty old text and runs one 400ms fade in", () => {
    const { span, advance, pending } = bilingual();
    expect(span.textContent).toBe("Привет");
    expect(animateSpy).toHaveBeenCalledTimes(1);
    expect(animateSpy).toHaveBeenCalledWith([{ opacity: 0 }, { opacity: 1 }], {
      duration: 400,
      easing: "ease-out",
      fill: "forwards",
    });
    advance(399);
    expect(span.textContent).toBe("Привет");
    expect(pending()).toBe(1);
    advance(1);
    expect(pending()).toBe(1);
    expect(anims[0]?.cancel).not.toHaveBeenCalled();
    advance(16);
    expect(pending()).toBe(0);
    expect(span.textContent).toBe("Привет");
    expect(anims[0]?.cancel).toHaveBeenCalled();
  });

  it("finish cancels the fade", () => {
    const { span, animator, advance } = bilingual();
    advance(100);
    animator.finishAll();
    expect(span.textContent).toBe("Привет");
    expect(anims[0]?.cancel).toHaveBeenCalled();
  });
});
