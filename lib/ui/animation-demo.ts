import { applyBilingual, applyReplace, createJournal, parseTranslated } from "../dom/apply";
import type { Animator, Token } from "../dom/effects/animator";
import type { Block } from "../dom/extract";
import { encodeNodes } from "../dom/placeholders";
import { type Lang, nextLang } from "./animation-logic";

export type DemoMode = "replace" | "bilingual";
export type SampleBlock = { tag: string; cls?: string; en: string; ru: string };
export type Sample = SampleBlock[];

export type Demo = {
  /** Static final state, no animation. */
  settle(lang: Lang, mode: DemoMode): void;
  /** Animated round: `to` is the language replace mode ends on, bilingual always shows the translation appearing. */
  run(to: Lang, mode: DemoMode): void;
  busy(): boolean;
  destroy(): void;
};

type Entry = { block: Block; element: Element; ru: string };

// the resting text of a preview is the translation
export const REST_LANG: Lang = "ru";

function fill(doc: Document, el: Element, tagged: string) {
  let parent: Element = el;
  const stack: Element[] = [];
  for (const token of parseTranslated(tagged)) {
    if (token.type === "text") {
      parent.append(doc.createTextNode(token.value));
    } else if (token.type === "open") {
      const link = doc.createElement("a");
      link.href = "#";
      link.tabIndex = -1;
      parent.append(link);
      stack.push(parent);
      parent = link;
    } else if (token.type === "close") {
      parent = stack.pop() ?? el;
    }
  }
}

function build(host: HTMLElement, sample: Sample): Entry[] {
  const doc = host.ownerDocument;
  host.replaceChildren();
  host.addEventListener("click", (e) => {
    if ((e.target as Element | null)?.closest("a")) e.preventDefault();
  });
  let list: Element | null = null;
  return sample.map((item, i) => {
    const element = doc.createElement(item.tag);
    if (item.cls) element.className = item.cls;
    fill(doc, element, item.en);
    if (item.tag === "li") {
      if (!list) {
        list = doc.createElement("ul");
        host.append(list);
      }
      list.append(element);
    } else {
      list = null;
      host.append(element);
    }
    const encoded = encodeNodes(Array.from(element.childNodes));
    return { block: { id: String(i), element, ...encoded }, element, ru: item.ru };
  });
}

/** The page translator's own apply code on a small fixed document, so the effects run exactly as on a page. */
export function createDemo(opts: { host: HTMLElement; sample: Sample; animator: Animator }): Demo {
  const { host, animator } = opts;
  const journal = createJournal();
  const entries = build(host, opts.sample);

  const mark = (lang: Lang, mode: DemoMode) => {
    host.dataset.mode = mode;
    for (const e of entries) e.element.setAttribute("lang", mode === "bilingual" ? "en" : lang);
  };

  const addTranslations = (tokens: Array<Token | null>) => {
    entries.forEach((e, i) => {
      const span = applyBilingual(e.block, e.ru, journal);
      span.setAttribute("lang", "ru");
      const token = tokens[i];
      if (token) animator.play(token, span);
    });
  };

  return {
    settle(lang, mode) {
      animator.finishAll();
      journal.restoreAll();
      if (mode === "bilingual") addTranslations([]);
      else if (lang === "ru") for (const e of entries) applyReplace(e.block, e.ru, journal);
      mark(lang, mode);
    },

    run(to, mode) {
      animator.finishAll();
      if (mode === "bilingual") journal.restoreAll();
      const tokens = entries.map((e) =>
        animator.prepare(e.element, { bilingual: mode === "bilingual", visible: true }),
      );
      if (mode === "bilingual") {
        addTranslations(tokens);
      } else {
        entries.forEach((e, i) => {
          if (to === "ru") applyReplace(e.block, e.ru, journal);
          else journal.restoreBlock(e.block);
          const token = tokens[i];
          if (token) animator.play(token, e.element);
        });
      }
      mark(to, mode);
    },

    busy: () => animator.busy(),

    destroy() {
      animator.finishAll();
    },
  };
}

export type Stage = {
  play(): void;
  setMode(mode: DemoMode): void;
  /** Drops running effects and keeps the current state. */
  settle(): void;
};

/** State of the article stage: replace mode flips the text on every run, bilingual replays the translation. */
export function createStage(demo: Demo): Stage {
  let mode: DemoMode = "replace";
  let shown: Lang = REST_LANG;
  demo.settle(shown, mode);

  const play = () => {
    if (mode === "replace") shown = nextLang(shown);
    demo.run(shown, mode);
  };

  return {
    play,
    setMode(next) {
      mode = next;
      demo.settle(shown, mode);
      play();
    },
    settle: () => demo.settle(shown, mode),
  };
}

export type HoverLoop = { start(): void; stop(): void };

/** Flips a card preview between the languages while the pointer or focus is on it. */
export function createHoverLoop(
  demo: Demo,
  opts: { pauseMs?: number; pollMs?: number } = {},
): HoverLoop {
  const pauseMs = opts.pauseMs ?? 900;
  const pollMs = opts.pollMs ?? 100;
  let running = false;
  let shown: Lang = REST_LANG;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const round = () => {
    shown = nextLang(shown);
    demo.run(shown, "replace");
    wait();
  };

  const wait = () => {
    timer = setTimeout(() => {
      if (demo.busy()) wait();
      else timer = setTimeout(round, pauseMs);
    }, pollMs);
  };

  return {
    start() {
      if (running) return;
      running = true;
      round();
    },
    stop() {
      if (!running) return;
      running = false;
      clearTimeout(timer);
      shown = REST_LANG;
      demo.settle(REST_LANG, "replace");
    },
  };
}
