import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MARK_ATTR } from "../../../lib/dom/constants";
import { setUiLang } from "../../../lib/i18n";
import { type CardDeps, createCard } from "../../../lib/selection/card";
import { STYLES } from "../../../lib/selection/styles";
import { mountSelectionUi, type SelectionUi } from "../../../lib/selection/trigger";
import type { Template } from "../../../lib/settings/types";

type Rect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
};
const rect = (left: number, top: number, right: number, bottom: number): Rect => ({
  left,
  top,
  right,
  bottom,
  width: right - left,
  height: bottom - top,
});

let roots: ShadowRoot[] = [];
let ui: SelectionUi | undefined;
const realAttachShadow = Element.prototype.attachShadow;

function shadow(): ShadowRoot {
  const root = roots.at(-1);
  if (!root) throw new Error("no shadow root");
  return root;
}
const icon = () => shadow().querySelector<HTMLElement>(".icon");
const card = () => shadow().querySelector<HTMLElement>(".card");

function selectText(node: Node, start: number, end: number) {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const sel = document.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  return range;
}

function paragraph(text: string) {
  const p = document.createElement("p");
  p.textContent = text;
  document.body.append(p);
  return p;
}

async function selectAndRelease(p: HTMLElement, start: number, end: number) {
  selectText(p.firstChild as Text, start, end);
  p.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  await vi.advanceTimersByTimeAsync(150);
}

const builtin: Template = {
  id: "builtin-default",
  name: "Plain translation",
  builtin: true,
  settings: {},
};
const custom: Template = { id: "t2", name: "Dictionary", builtin: false, settings: {} };

function mount(overrides: Partial<Parameters<typeof mountSelectionUi>[1]> = {}) {
  const translate = vi.fn().mockResolvedValue({ text: "**привет** мир" });
  const listTemplates = vi.fn().mockResolvedValue([builtin, custom]);
  ui = mountSelectionUi(document, { translate, listTemplates, ...overrides });
  return { translate, listTemplates };
}

beforeEach(() => {
  vi.useFakeTimers();
  roots = [];
  setUiLang("en");
  vi.spyOn(Element.prototype, "attachShadow").mockImplementation(function (
    this: Element,
    init: ShadowRootInit,
  ) {
    const root = realAttachShadow.call(this, init);
    roots.push(root);
    return root;
  });
  vi.spyOn(Range.prototype, "getClientRects").mockReturnValue([
    rect(10, 100, 50, 120),
    rect(10, 130, 90, 150),
    rect(0, 0, 0, 0),
  ] as unknown as DOMRectList);
  vi.spyOn(Range.prototype, "getBoundingClientRect").mockReturnValue(
    rect(10, 100, 90, 150) as DOMRect,
  );
});

afterEach(() => {
  ui?.destroy();
  ui = undefined;
  document.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("selection trigger icon", () => {
  it("mounts one marked host with a closed shadow root", () => {
    mount();
    expect(document.querySelectorAll(`[${MARK_ATTR}]`)).toHaveLength(1);
    expect(document.querySelector(`[${MARK_ATTR}]`)?.shadowRoot).toBeNull();
  });

  it("shows the icon after the debounce and sends nothing", async () => {
    const { translate } = mount();
    const p = paragraph("Many historians describe serendipity.");
    selectText(p.firstChild as Text, 5, 15);
    p.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(100);
    expect(icon()).toBeNull();
    await vi.advanceTimersByTimeAsync(60);
    expect(icon()).not.toBeNull();
    await vi.advanceTimersByTimeAsync(5000);
    expect(translate).not.toHaveBeenCalled();
  });

  it("places the icon above the top-right of the last rect", async () => {
    mount();
    const p = paragraph("Many historians describe serendipity.");
    await selectAndRelease(p, 5, 15);
    expect(icon()?.style.left).toBe("66px");
    expect(icon()?.style.top).toBe("102px");
  });

  it("places the icon below the last rect when there is no room above", async () => {
    vi.spyOn(Range.prototype, "getClientRects").mockReturnValue([
      rect(10, 10, 90, 30),
    ] as unknown as DOMRectList);
    mount();
    const p = paragraph("Many historians describe serendipity.");
    await selectAndRelease(p, 5, 15);
    expect(icon()?.style.top).toBe("34px");
  });

  it("clamps the icon to the viewport", async () => {
    vi.spyOn(Range.prototype, "getClientRects").mockReturnValue([
      rect(window.innerWidth - 20, 100, window.innerWidth + 400, 120),
    ] as unknown as DOMRectList);
    mount();
    const p = paragraph("Many historians describe serendipity.");
    await selectAndRelease(p, 5, 15);
    expect(icon()?.style.left).toBe(`${window.innerWidth - 24 - 4}px`);
  });

  it("uses the end of the range for a backward selection", async () => {
    mount();
    const p = paragraph("Many historians describe serendipity.");
    const text = p.firstChild as Text;
    document.getSelection()?.setBaseAndExtent(text, 15, text, 5);
    p.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(150);
    expect(icon()?.style.left).toBe("66px");
  });

  it("ignores selections inside textarea and input", async () => {
    mount();
    const ta = document.createElement("textarea");
    ta.value = "hello world";
    ta.textContent = "hello world";
    document.body.append(ta);
    ta.focus();
    selectText(ta.firstChild as Text, 0, 5);
    ta.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(150);
    expect(icon()).toBeNull();

    const input = document.createElement("input");
    input.value = "hello world";
    document.body.append(input);
    input.focus();
    input.select();
    const p = paragraph("outside text");
    selectText(p.firstChild as Text, 0, 7);
    input.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(150);
    expect(icon()).toBeNull();
  });

  it("ignores contenteditable selections", async () => {
    mount();
    const div = document.createElement("div");
    div.setAttribute("contenteditable", "true");
    div.textContent = "editable text";
    document.body.append(div);
    await selectAndRelease(div, 0, 8);
    expect(icon()).toBeNull();
  });

  it("hides on collapse, over-long selection shows nothing", async () => {
    mount();
    const p = paragraph("Many historians describe serendipity.");
    await selectAndRelease(p, 5, 15);
    expect(icon()).not.toBeNull();
    document.getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));
    expect(icon()).toBeNull();

    const long = paragraph("x".repeat(5001));
    await selectAndRelease(long, 0, 5001);
    expect(icon()).toBeNull();
  });

  it("hides on mousedown outside and on scroll", async () => {
    mount();
    const p = paragraph("Many historians describe serendipity.");
    await selectAndRelease(p, 5, 15);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(icon()).toBeNull();
    await selectAndRelease(p, 5, 15);
    expect(icon()).not.toBeNull();
    window.dispatchEvent(new Event("scroll"));
    expect(icon()).toBeNull();
  });
});

describe("shadow styles", () => {
  it("draws a visible resize grip", () => {
    const rule = STYLES.split("\n").find((l) => l.startsWith(".grip{")) ?? "";
    expect(rule).toContain("linear-gradient");
    expect(rule).toContain("var(--bd2)");
  });

  it("puts font and color-scheme declarations on the wrapper inside the shadow root", () => {
    mount();
    const root = shadow().querySelector(".root");
    expect(root).not.toBeNull();
    const rule = /\.root\{([^}]*)\}/.exec(STYLES)?.[1] ?? "";
    for (const prop of ["font-family", "font-size", "line-height", "color", "color-scheme"]) {
      expect(rule).toMatch(new RegExp(`(^|;)${prop}:`));
    }
    expect(STYLES).not.toMatch(/:host\{/);
  });

  it("renders the icon and card inside the wrapper", async () => {
    mount();
    const p = paragraph("Many historians describe serendipity.");
    await selectAndRelease(p, 5, 15);
    expect(shadow().querySelector(".root > .icon")).not.toBeNull();
    icon()?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(shadow().querySelector(".root > .card")).not.toBeNull();
  });
});

describe("selection card", () => {
  it("does not re-show the icon over an open card on shift keyup", async () => {
    mount();
    const p = paragraph("Many historians describe serendipity.");
    selectText(p.firstChild as Text, 5, 15);
    ui?.trigger();
    await vi.advanceTimersByTimeAsync(0);
    expect(card()).not.toBeNull();
    document.dispatchEvent(
      new KeyboardEvent("keyup", { key: "Shift", shiftKey: true, bubbles: true }),
    );
    await vi.advanceTimersByTimeAsync(300);
    expect(icon()).toBeNull();
  });

  it("trigger() cancels a pending debounced check", async () => {
    mount();
    const p = paragraph("Many historians describe serendipity.");
    selectText(p.firstChild as Text, 5, 15);
    p.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    ui?.trigger();
    await vi.advanceTimersByTimeAsync(300);
    expect(icon()).toBeNull();
  });

  it("trigger() translates a selection inside an input, the icon never appears there", async () => {
    const { translate } = mount();
    const input = document.createElement("input");
    input.value = "write hello world now";
    document.body.append(input);
    input.focus();
    input.setSelectionRange(6, 17);
    input.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(300);
    expect(icon()).toBeNull();
    expect(ui?.hasSelection()).toBe(true);
    ui?.trigger();
    await vi.advanceTimersByTimeAsync(0);
    expect(translate).toHaveBeenCalledWith("hello world", "write hello world now");
  });

  it("trigger() in a textarea translates the selected slice", async () => {
    const { translate } = mount();
    const ta = document.createElement("textarea");
    ta.value = "alpha beta gamma";
    document.body.append(ta);
    ta.focus();
    ta.setSelectionRange(6, 10);
    ui?.trigger();
    await vi.advanceTimersByTimeAsync(0);
    expect(translate).toHaveBeenCalledWith("beta", "alpha beta gamma");
  });

  it("trigger() never reads a password field", async () => {
    const { translate } = mount();
    const input = document.createElement("input");
    input.type = "password";
    input.value = "hunter2 secret";
    document.body.append(input);
    input.focus();
    input.setSelectionRange(0, 7);
    expect(ui?.hasSelection()).toBe(false);
    ui?.trigger();
    await vi.advanceTimersByTimeAsync(0);
    expect(translate).not.toHaveBeenCalled();
  });

  it("trigger() ignores an empty field selection", async () => {
    const { translate } = mount();
    const input = document.createElement("input");
    input.value = "hello";
    document.body.append(input);
    input.focus();
    input.setSelectionRange(2, 2);
    ui?.trigger();
    await vi.advanceTimersByTimeAsync(0);
    expect(translate).not.toHaveBeenCalled();
  });

  it("shows the language pair and the model line from the result", async () => {
    mount({
      translate: vi.fn().mockResolvedValue({
        text: "готово",
        sourceLang: "auto",
        targetLang: "ru",
        model: { providerID: "deepseek", id: "deepseek-flash", variant: "none" },
      }),
    });
    const p = paragraph("Many historians describe serendipity.");
    await selectAndRelease(p, 5, 15);
    icon()?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(card()?.querySelector(".lang")?.textContent).toMatch(/^Auto \u2192 Russian$/);
    expect(card()?.querySelector(".mono.muted")?.textContent).toBe("deepseek-flash \u00b7 none");
  });

  it("rate_limit offers Open settings instead of Retry", async () => {
    const openSettings = vi.fn();
    mount({
      translate: vi.fn().mockResolvedValue({ error: "rate_limit", retryAfterMs: 60_000 }),
      openSettings,
    });
    const p = paragraph("Many historians describe serendipity.");
    await selectAndRelease(p, 5, 15);
    icon()?.click();
    await vi.advanceTimersByTimeAsync(0);
    const btn = card()?.querySelector<HTMLButtonElement>(".btn.sm");
    expect(btn?.textContent).toBe("Open settings");
    expect(card()?.textContent).not.toContain("Retry");
    btn?.click();
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it("shows Copy failed when the clipboard rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { language: "en", clipboard: { writeText } });
    mount();
    const p = paragraph("Many historians describe serendipity.");
    await selectAndRelease(p, 5, 15);
    icon()?.click();
    await vi.advanceTimersByTimeAsync(0);
    const copy = card()?.querySelector<HTMLButtonElement>(".btn.sm");
    copy?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(copy?.textContent).toBe("Copy failed");
    await vi.advanceTimersByTimeAsync(2000);
    expect(copy?.textContent).toBe("Copy");
  });

  it("click sends exactly the selection with block context and renders the result", async () => {
    const { translate } = mount();
    const p = paragraph("Many historians describe  serendipity\n as luck.");
    await selectAndRelease(p, 24, 35);
    const selected = document.getSelection()?.toString().trim() ?? "";
    icon()?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(translate).toHaveBeenCalledTimes(1);
    expect(translate).toHaveBeenCalledWith(
      selected,
      "Many historians describe serendipity as luck.",
    );
    expect(card()?.querySelector(".md strong")?.textContent).toBe("привет");
    expect(icon()).toBeNull();
  });

  it("limits context to 1000 chars around the selection", async () => {
    const { translate } = mount();
    const body = `${"a ".repeat(1500)}TARGET${" b".repeat(1500)}`;
    const p = paragraph(body);
    await selectAndRelease(p, 3000, 3006);
    icon()?.click();
    await vi.advanceTimersByTimeAsync(0);
    const context = translate.mock.calls[0]?.[1] as string;
    expect(context.length).toBeLessThanOrEqual(1000);
    expect(context).toContain("TARGET");
  });

  it("shows a loading state until the result arrives", async () => {
    let resolve: (v: { text: string }) => void = () => {};
    mount({ translate: vi.fn().mockReturnValue(new Promise((r) => (resolve = r))) });
    const p = paragraph("Many historians describe serendipity.");
    await selectAndRelease(p, 5, 15);
    icon()?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(card()?.querySelector(".spin")).not.toBeNull();
    expect(card()?.textContent).toContain("Translating");
    resolve({ text: "готово" });
    await vi.advanceTimersByTimeAsync(0);
    expect(card()?.querySelector(".spin")).toBeNull();
    expect(card()?.textContent).toContain("готово");
  });

  it("Escape closes the card", async () => {
    mount();
    const p = paragraph("Many historians describe serendipity.");
    await selectAndRelease(p, 5, 15);
    icon()?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(card()).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(card()).toBeNull();
  });

  it("mousedown outside closes the card", async () => {
    mount();
    const p = paragraph("Many historians describe serendipity.");
    await selectAndRelease(p, 5, 15);
    icon()?.click();
    await vi.advanceTimersByTimeAsync(0);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(card()).toBeNull();
  });

  it("shows localized errors with time until reset for rate_limit", async () => {
    mount({
      translate: vi.fn().mockResolvedValue({ error: "rate_limit", retryAfterMs: 5_040_000 }),
    });
    const p = paragraph("Many historians describe serendipity.");
    await selectAndRelease(p, 5, 15);
    icon()?.click();
    await vi.advanceTimersByTimeAsync(0);
    const alert = card()?.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Provider limit reached");
    expect(alert?.textContent).toContain("1 h 24 min");
  });

  it("shows the offline hint in Russian", async () => {
    setUiLang("ru");
    mount({ translate: vi.fn().mockResolvedValue({ error: "offline" }) });
    const p = paragraph("Many historians describe serendipity.");
    await selectAndRelease(p, 5, 15);
    icon()?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(card()?.textContent).toContain("opencode не запущен");
    expect(card()?.textContent).toContain("opencode service start");
  });

  it("retry resends the request", async () => {
    const translate = vi
      .fn()
      .mockResolvedValueOnce({ error: "offline" })
      .mockResolvedValueOnce({ text: "ok" });
    mount({ translate });
    const p = paragraph("Many historians describe serendipity.");
    await selectAndRelease(p, 5, 15);
    icon()?.click();
    await vi.advanceTimersByTimeAsync(0);
    card()?.querySelector<HTMLButtonElement>(".btn.sm")?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(translate).toHaveBeenCalledTimes(2);
    expect(card()?.textContent).toContain("ok");
  });

  it("labels the builtin template and retranslates with the chosen one", async () => {
    const { translate } = mount({ currentTemplateId: vi.fn().mockResolvedValue("t2") });
    const p = paragraph("Many historians describe serendipity.");
    await selectAndRelease(p, 5, 15);
    icon()?.click();
    await vi.advanceTimersByTimeAsync(0);
    const select = card()?.querySelector("select") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "Plain translation",
      "Dictionary",
    ]);
    expect(select.value).toBe("t2");
    select.value = "builtin-default";
    select.dispatchEvent(new Event("change"));
    await vi.advanceTimersByTimeAsync(0);
    expect(translate).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(String),
      "builtin-default",
    );

    const retranslate = [...(card()?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent === "Translate again",
    );
    retranslate?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(translate).toHaveBeenCalledTimes(3);
    expect(translate).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(String),
      "builtin-default",
    );
  });

  it("retranslate without changing the template sends no template override", async () => {
    const { translate } = mount({ currentTemplateId: vi.fn().mockResolvedValue("t2") });
    const p = paragraph("Many historians describe serendipity.");
    await selectAndRelease(p, 5, 15);
    icon()?.click();
    await vi.advanceTimersByTimeAsync(0);
    const retranslate = [...(card()?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent === "Translate again",
    );
    retranslate?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(translate).toHaveBeenCalledTimes(2);
    expect(translate).toHaveBeenLastCalledWith(expect.any(String), expect.any(String));
  });

  it("closing the card while the request is in flight cancels it", async () => {
    const cancel = vi.fn();
    mount({ translate: vi.fn(() => new Promise<never>(() => {})), cancel });
    const p = paragraph("Many historians describe serendipity.");
    await selectAndRelease(p, 5, 15);
    icon()?.click();
    await vi.advanceTimersByTimeAsync(0);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("no_model offers to open the settings", async () => {
    const openSettings = vi.fn();
    mount({ translate: vi.fn().mockResolvedValue({ error: "no_model" }), openSettings });
    const p = paragraph("Many historians describe serendipity.");
    await selectAndRelease(p, 5, 15);
    icon()?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(card()?.textContent).toContain("Choose a model in settings.");
    const btn = card()?.querySelector<HTMLButtonElement>(".err .btn.sm");
    expect(btn?.textContent).toBe("Open settings");
    btn?.click();
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it("copies the raw result and confirms", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { language: "en", clipboard: { writeText } });
    mount();
    const p = paragraph("Many historians describe serendipity.");
    await selectAndRelease(p, 5, 15);
    icon()?.click();
    await vi.advanceTimersByTimeAsync(0);
    const copy = card()?.querySelector<HTMLButtonElement>(".btn.sm");
    copy?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(writeText).toHaveBeenCalledWith("**привет** мир");
    expect(copy?.textContent).toBe("Copied");
    await vi.advanceTimersByTimeAsync(2000);
    expect(copy?.textContent).toBe("Copy");
  });

  it("trigger() translates the current selection without the icon", async () => {
    const { translate } = mount();
    const p = paragraph("Many historians describe serendipity.");
    const range = selectText(p.firstChild as Text, 5, 15);
    expect(ui?.hasSelection()).toBe(true);
    ui?.trigger();
    await vi.advanceTimersByTimeAsync(0);
    expect(translate).toHaveBeenCalledWith(
      range.toString().trim(),
      "Many historians describe serendipity.",
    );
    expect(card()).not.toBeNull();
  });

  it("trigger() does nothing without a selection", async () => {
    const { translate } = mount();
    paragraph("Many historians describe serendipity.");
    expect(ui?.hasSelection()).toBe(false);
    ui?.trigger();
    await vi.advanceTimersByTimeAsync(0);
    expect(translate).not.toHaveBeenCalled();
    expect(card()).toBeNull();
  });
});

describe("pinned card", () => {
  type Res = { text: string } | { error: "offline" };
  const anchor = { left: 100, right: 200, top: 100, bottom: 120 };
  const req = (text: string) => ({ text, context: "ctx", anchor });
  let host: HTMLElement;
  let cardApi: ReturnType<typeof createCard>;

  function setup(overrides: Partial<CardDeps> = {}) {
    const resolvers: Array<(r: Res) => void> = [];
    const translate = vi.fn(
      () => new Promise<Res>((resolve) => resolvers.push(resolve)),
    ) as unknown as CardDeps["translate"] & ReturnType<typeof vi.fn>;
    const cancel = vi.fn();
    host = document.createElement("div");
    document.body.append(host);
    cardApi = createCard(host, {
      translate,
      cancel,
      listTemplates: vi.fn().mockResolvedValue([builtin, custom]),
      ...overrides,
    });
    return { translate, cancel, resolvers };
  }

  const entries = () => [...host.querySelectorAll<HTMLElement>(".entry")];
  const flush = () => vi.advanceTimersByTimeAsync(0);
  const pinBtn = () => host.querySelector<HTMLButtonElement>(".pin");
  const closeBtn = () => host.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
  const btn = (root: ParentNode, label: string) =>
    [...root.querySelectorAll("button")].find((b) => b.textContent === label);

  afterEach(() => {
    cardApi?.close();
    host?.remove();
  });

  it("the pin button switches to pinned and keeps the current result as the first entry", async () => {
    const { resolvers } = setup();
    cardApi.open(req("alpha"));
    resolvers[0]?.({ text: "one" });
    await flush();
    expect(pinBtn()?.getAttribute("aria-pressed")).toBe("false");
    expect(cardApi.mode()).toBe("oneshot");
    expect(entries()[0]?.querySelector(".src")).toBeNull();
    pinBtn()?.click();
    expect(pinBtn()?.getAttribute("aria-pressed")).toBe("true");
    expect(cardApi.mode()).toBe("pinned");
    expect(entries()).toHaveLength(1);
    expect(entries()[0]?.textContent).toContain("one");
    expect(entries()[0]?.querySelector(".src")?.textContent).toBe("alpha");
  });

  it("add three times gives three entries, newest first, each with its source and own Copy", async () => {
    const { resolvers } = setup();
    cardApi.open(req("a"));
    cardApi.setMode("pinned");
    cardApi.add(req("b"));
    cardApi.add(req("c"));
    for (const [i, r] of resolvers.entries()) r({ text: `r${i}` });
    await flush();
    const list = entries();
    expect(list).toHaveLength(3);
    expect(list[0]?.textContent).toContain("r2");
    expect(list.map((e) => e.querySelector(".src")?.textContent)).toEqual(["c", "b", "a"]);
    for (const e of list) expect(btn(e, "Copy")).toBeDefined();
    expect(cardApi.lastText()).toBe("c");
  });

  it("a second add while the first loads does not cancel it", async () => {
    const { cancel, translate, resolvers } = setup();
    cardApi.open(req("a"));
    cardApi.setMode("pinned");
    cardApi.add(req("b"));
    expect(cancel).not.toHaveBeenCalled();
    expect(translate).toHaveBeenCalledTimes(2);
    resolvers[1]?.({ text: "rb" });
    resolvers[0]?.({ text: "ra" });
    await flush();
    expect(entries()[0]?.textContent).toContain("rb");
    expect(entries()[1]?.textContent).toContain("ra");
  });

  it("retry in a failed entry resends only its text and leaves the loading entry alone", async () => {
    const { translate, resolvers } = setup();
    cardApi.open(req("a"));
    cardApi.setMode("pinned");
    cardApi.add(req("b"));
    resolvers[0]?.({ error: "offline" });
    await flush();
    const failed = entries()[1] as HTMLElement;
    expect(entries()[0]?.querySelector(".spin")).not.toBeNull();
    btn(failed, "Retry")?.click();
    expect(translate).toHaveBeenCalledTimes(3);
    expect(translate).toHaveBeenLastCalledWith("a", "ctx");
    expect(entries()[0]?.querySelector(".spin")).not.toBeNull();
    resolvers[1]?.({ text: "rb" });
    resolvers[2]?.({ text: "ra" });
    await flush();
    expect(entries()[0]?.textContent).toContain("rb");
    expect(entries()[1]?.textContent).toContain("ra");
  });

  it("changing the template in pinned translates nothing, the next add uses it", async () => {
    const { translate, resolvers } = setup();
    cardApi.open(req("a"));
    cardApi.setMode("pinned");
    resolvers[0]?.({ text: "ra" });
    await flush();
    const select = host.querySelector("select") as HTMLSelectElement;
    select.value = "t2";
    select.dispatchEvent(new Event("change"));
    await flush();
    expect(translate).toHaveBeenCalledTimes(1);
    cardApi.add(req("b"));
    expect(translate).toHaveBeenLastCalledWith("b", "ctx", "t2");
  });

  it("pressing the pin again returns to oneshot with only the top entry", async () => {
    const { resolvers } = setup();
    cardApi.open(req("a"));
    cardApi.setMode("pinned");
    cardApi.add(req("b"));
    for (const [i, r] of resolvers.entries()) r({ text: `r${i}` });
    await flush();
    pinBtn()?.click();
    expect(cardApi.mode()).toBe("oneshot");
    expect(pinBtn()?.getAttribute("aria-pressed")).toBe("false");
    expect(entries()).toHaveLength(1);
    expect(entries()[0]?.textContent).toContain("r1");
    expect(entries()[0]?.querySelector(".src")).toBeNull();
  });

  it("the cross cancels everything in pinned and closes the card", () => {
    const { cancel } = setup();
    cardApi.open(req("a"));
    cardApi.setMode("pinned");
    cardApi.add(req("b"));
    closeBtn()?.click();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cardApi.isOpen()).toBe(false);
    expect(host.querySelector(".card")).toBeNull();
  });

  it("unpinning with pending entries cancels, re-runs the top one and ignores late answers", async () => {
    const { cancel, translate, resolvers } = setup();
    cardApi.open(req("a"));
    cardApi.setMode("pinned");
    cardApi.add(req("b"));
    expect(translate).toHaveBeenCalledTimes(2);
    pinBtn()?.click();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(translate).toHaveBeenCalledTimes(3);
    expect(translate).toHaveBeenLastCalledWith("b", "ctx");
    resolvers[0]?.({ text: "late-a" });
    resolvers[1]?.({ text: "late-b" });
    await flush();
    expect(entries()).toHaveLength(1);
    expect(entries()[0]?.querySelector(".spin")).not.toBeNull();
    resolvers[2]?.({ text: "fresh-b" });
    await flush();
    expect(entries()[0]?.textContent).toContain("fresh-b");
    closeBtn()?.click();
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it("unpinning with nothing pending does not cancel or re-run", async () => {
    const { cancel, translate, resolvers } = setup();
    cardApi.open(req("a"));
    cardApi.setMode("pinned");
    cardApi.add(req("b"));
    for (const [i, r] of resolvers.entries()) r({ text: `r${i}` });
    await flush();
    pinBtn()?.click();
    expect(cancel).not.toHaveBeenCalled();
    expect(translate).toHaveBeenCalledTimes(2);
  });

  it("the cross cancels even when an unpin retired the pending entries", async () => {
    const { cancel, resolvers } = setup();
    cardApi.open(req("a"));
    cardApi.setMode("pinned");
    cardApi.add(req("b"));
    cardApi.add(req("c"));
    resolvers[2]?.({ text: "rc" });
    await flush();
    cardApi.setMode("oneshot");
    cancel.mockClear();
    closeBtn()?.click();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("a new pinned entry scrolls the feed back to the top", async () => {
    setup();
    cardApi.open(req("a"));
    cardApi.setMode("pinned");
    const feed = host.querySelector(".feed") as HTMLElement;
    feed.scrollTop = 300;
    cardApi.add(req("b"));
    expect(feed.scrollTop).toBe(0);
  });

  it("pinning grows a cramped card to the minimum height unless the user resized it", () => {
    setup();
    cardApi.open(req("a"));
    const el = host.querySelector(".card") as HTMLElement;
    expect(Number.parseFloat(el.style.height)).toBeLessThan(420);
    cardApi.setMode("pinned");
    expect(Number.parseFloat(el.style.height)).toBe(420);
  });

  it("pinning keeps a taller card and a user-resized card as they are", () => {
    setup();
    cardApi.open(req("a"));
    const el = host.querySelector(".card") as HTMLElement;
    const grip = el.querySelector(".grip") as HTMLElement;
    for (const [type, y] of [
      ["pointerdown", 0],
      ["pointermove", 20],
    ] as const) {
      grip.dispatchEvent(new PointerEvent(type, { clientY: y, pointerId: 1, bubbles: true }));
    }
    const before = el.style.height;
    cardApi.setMode("pinned");
    expect(el.style.height).toBe(before);
  });

  it("Escape does nothing in pinned and the Esc hint is hidden", async () => {
    const { resolvers } = setup();
    cardApi.open(req("a"));
    resolvers[0]?.({ text: "ra" });
    await flush();
    expect(host.querySelector("kbd")).not.toBeNull();
    cardApi.setMode("pinned");
    expect(host.querySelector("kbd")).toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(cardApi.isOpen()).toBe(true);
  });

  it("marks the card free in pinned and after a resize", () => {
    setup();
    cardApi.open(req("a"));
    const el = host.querySelector(".card") as HTMLElement;
    expect(el.classList.contains("free")).toBe(false);
    cardApi.setMode("pinned");
    expect(el.classList.contains("free")).toBe(true);
    cardApi.setMode("oneshot");
    expect(el.classList.contains("free")).toBe(false);
    const grip = el.querySelector(".grip") as HTMLElement;
    for (const [type, x] of [
      ["pointerdown", 0],
      ["pointermove", 30],
    ] as const) {
      grip.dispatchEvent(new PointerEvent(type, { clientX: x, pointerId: 1, bubbles: true }));
    }
    expect(el.classList.contains("free")).toBe(true);
    expect(STYLES).toContain(".free .scroll{max-height:none");
  });

  it("inSafeZone follows the window and is false when closed", () => {
    setup();
    expect(cardApi.inSafeZone(10, 10)).toBe(false);
    cardApi.open(req("a"));
    const el = host.querySelector(".card") as HTMLElement;
    const left = Number.parseFloat(el.style.left);
    const top = Number.parseFloat(el.style.top);
    expect(cardApi.inSafeZone(left - 10, top - 10)).toBe(true);
    expect(cardApi.inSafeZone(left - 17, top)).toBe(false);
    cardApi.close();
    expect(cardApi.inSafeZone(left, top)).toBe(false);
  });

  it("in oneshot a template change while loading cancels the old request first", async () => {
    const { cancel, translate } = setup();
    cardApi.open(req("a"));
    await flush();
    const select = host.querySelector("select") as HTMLSelectElement;
    select.value = "t2";
    select.dispatchEvent(new Event("change"));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(translate).toHaveBeenCalledTimes(2);
  });
});

describe("selection window events", () => {
  const TEXT = "Many historians describe serendipity.";
  const pin = () => shadow().querySelector<HTMLButtonElement>(".pin");
  const entries = () => shadow().querySelectorAll(".entry");
  const down = (x: number, y: number) =>
    document.body.dispatchEvent(
      new MouseEvent("mousedown", { clientX: x, clientY: y, bubbles: true }),
    );
  const cardPos = () => {
    const el = card() as HTMLElement;
    return { left: Number.parseFloat(el.style.left), top: Number.parseFloat(el.style.top) };
  };

  async function openCard(p: HTMLElement) {
    selectText(p.firstChild as Text, 5, 15);
    ui?.trigger();
    await vi.advanceTimersByTimeAsync(0);
  }

  async function openPinned() {
    const m = mount();
    const p = paragraph(TEXT);
    await openCard(p);
    pin()?.click();
    return { ...m, p };
  }

  it("oneshot: mousedown inside the safe zone keeps the card, outside closes it", async () => {
    mount();
    await openCard(paragraph(TEXT));
    const { left, top } = cardPos();
    down(left - 10, top - 10);
    expect(card()).not.toBeNull();
    down(left - 17, top);
    expect(card()).toBeNull();
  });

  it("oneshot: Escape closes the card", async () => {
    mount();
    await openCard(paragraph(TEXT));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(card()).toBeNull();
  });

  it("oneshot: trigger() reopens the card with the new selection", async () => {
    const { translate } = mount();
    const p = paragraph(TEXT);
    await openCard(p);
    selectText(p.firstChild as Text, 0, 4);
    ui?.trigger();
    await vi.advanceTimersByTimeAsync(0);
    expect(entries()).toHaveLength(1);
    expect(translate).toHaveBeenCalledTimes(2);
    expect(translate).toHaveBeenLastCalledWith("Many", TEXT);
  });

  it("pinned: mousedown outside and Escape keep the card", async () => {
    await openPinned();
    down(5000, 5000);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(card()).not.toBeNull();
  });

  it("pinned: a new selection translates on mouseup without the icon, newest on top", async () => {
    const { translate, p } = await openPinned();
    translate.mockClear();
    await selectAndRelease(p, 0, 4);
    expect(translate).toHaveBeenCalledTimes(1);
    expect(translate).toHaveBeenCalledWith("Many", TEXT);
    expect(icon()).toBeNull();
    expect(entries()).toHaveLength(2);
    expect(entries()[0]?.querySelector(".src")?.textContent).toBe("Many");
  });

  it("pinned: mouseup with an unchanged selection adds no duplicate", async () => {
    const { translate, p } = await openPinned();
    await selectAndRelease(p, 0, 4);
    translate.mockClear();
    await selectAndRelease(p, 0, 4);
    expect(translate).not.toHaveBeenCalled();
    expect(entries()).toHaveLength(2);
  });

  it("pinned: a selection inside the window does not translate", async () => {
    const { translate } = await openPinned();
    await vi.advanceTimersByTimeAsync(0);
    translate.mockClear();
    const src = shadow().querySelector(".src") as HTMLElement;
    selectText(src.firstChild as Text, 0, 4);
    const host = document.querySelector(`[${MARK_ATTR}]`) as HTMLElement;
    host.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(300);
    expect(translate).not.toHaveBeenCalled();
  });

  it("pinned: a page selection released over the window still translates", async () => {
    const { translate, p } = await openPinned();
    translate.mockClear();
    selectText(p.firstChild as Text, 0, 4);
    const host = document.querySelector(`[${MARK_ATTR}]`) as HTMLElement;
    host.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(300);
    expect(translate).toHaveBeenCalledWith("Many", TEXT);
    expect(entries()).toHaveLength(2);
  });

  it("oneshot: a new selection next to the card closes it and shows the icon", async () => {
    mount();
    const p = paragraph(TEXT);
    await openCard(p);
    const { left, top } = cardPos();
    selectText(p.firstChild as Text, 0, 4);
    down(left - 10, top - 10);
    p.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(150);
    expect(card()).toBeNull();
    expect(icon()).not.toBeNull();
  });

  it("oneshot: mouseup after a click in the safe zone without a selection keeps the card", async () => {
    mount();
    await openCard(paragraph(TEXT));
    const { left, top } = cardPos();
    down(left - 10, top - 10);
    document.body.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(150);
    expect(card()).not.toBeNull();
  });

  async function clickClose() {
    const x = shadow().querySelector<HTMLButtonElement>('button[aria-label="Close"]');
    // the page sees events from a closed shadow root retargeted to the host
    const host = document.querySelector(`[${MARK_ATTR}]`) as HTMLElement;
    host.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    host.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    x?.click();
    await vi.advanceTimersByTimeAsync(150);
  }

  it("oneshot: closing with the cross does not bring the icon back", async () => {
    mount();
    await openCard(paragraph(TEXT));
    await clickClose();
    expect(card()).toBeNull();
    expect(icon()).toBeNull();
  });

  it("pinned: closing with the cross does not bring the icon back", async () => {
    await openPinned();
    await clickClose();
    expect(card()).toBeNull();
    expect(icon()).toBeNull();
  });

  it("pinned: keyboard selection with Shift+arrows does not translate", async () => {
    const { translate, p } = await openPinned();
    translate.mockClear();
    selectText(p.firstChild as Text, 0, 4);
    document.dispatchEvent(
      new KeyboardEvent("keyup", { key: "ArrowRight", shiftKey: true, bubbles: true }),
    );
    await vi.advanceTimersByTimeAsync(300);
    expect(translate).not.toHaveBeenCalled();
    expect(icon()).toBeNull();
  });

  it("pinned: a selection in a textarea is not translated by mouseup, trigger() adds it", async () => {
    const { translate } = await openPinned();
    translate.mockClear();
    const ta = document.createElement("textarea");
    ta.value = "alpha beta gamma";
    document.body.append(ta);
    ta.focus();
    ta.setSelectionRange(6, 10);
    ta.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(300);
    expect(translate).not.toHaveBeenCalled();
    ui?.trigger();
    await vi.advanceTimersByTimeAsync(0);
    expect(translate).toHaveBeenCalledWith("beta", "alpha beta gamma");
    expect(entries()).toHaveLength(2);
  });

  it("pinned: trigger() with the same text still adds an entry", async () => {
    const { p } = await openPinned();
    selectText(p.firstChild as Text, 5, 15);
    ui?.trigger();
    await vi.advanceTimersByTimeAsync(0);
    expect(entries()).toHaveLength(2);
  });
});
