import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { countClosedShadow, queryClosedShadow } from "./shadow";

test("selection icon opens a card with the translated selection", async ({ paired, mock }) => {
  const page = await paired.context.newPage();
  await page.goto(`${mock.url}/fixtures/article.html`);

  await page.locator("#sel").click({ clickCount: 3 });
  const selected = (await page.evaluate(() => getSelection()?.toString() ?? "")).trim();
  expect(selected).toBe("A small sentence that we will select for the card.");

  await expect.poll(() => queryClosedShadow(page, "button.icon")).not.toBeNull();
  const hit = await queryClosedShadow(page, "button.icon");
  if (!hit) throw new Error("icon disappeared");
  await page.mouse.click(hit.center.x, hit.center.y);

  await expect
    .poll(async () => (await queryClosedShadow(page, ".card .scroll"))?.text.trim())
    .toBe(`[ru] ${selected}`);
});

test("selection prompt carries the language style block", async ({ paired, mock }) => {
  const page = await paired.context.newPage();
  await page.goto(`${mock.url}/fixtures/article.html`);

  await page.locator("#sel").click({ clickCount: 3 });
  await expect.poll(() => queryClosedShadow(page, "button.icon")).not.toBeNull();
  const hit = await queryClosedShadow(page, "button.icon");
  if (!hit) throw new Error("icon disappeared");
  await page.mouse.click(hit.center.x, hit.center.y);
  await expect
    .poll(async () => (await queryClosedShadow(page, ".card .scroll"))?.text.trim())
    .toContain("[ru] ");

  const prompts = mock.requests
    .filter((r) => r.path === "/api/experimental/generate/text")
    .map((r) => (r.body as { prompt: string }).prompt);
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toContain("LANGUAGE STYLE");
});

test("pinned card collects a feed, ignores outside clicks and closes with the cross", async ({
  paired,
  mock,
}) => {
  const page = await paired.context.newPage();
  await page.goto(`${mock.url}/fixtures/article.html`);

  await page.locator("#sel").click({ clickCount: 3 });
  await expect.poll(() => queryClosedShadow(page, "button.icon")).not.toBeNull();
  const icon = await queryClosedShadow(page, "button.icon");
  if (!icon) throw new Error("icon disappeared");
  await page.mouse.click(icon.center.x, icon.center.y);
  await expect.poll(() => queryClosedShadow(page, ".card .scroll")).not.toBeNull();

  const pin = await queryClosedShadow(page, ".pin");
  if (!pin) throw new Error("pin button missing");
  await page.mouse.click(pin.center.x, pin.center.y);
  await expect.poll(() => countClosedShadow(page, ".pin[aria-pressed='true']")).toBe(1);
  await expect.poll(() => countClosedShadow(page, ".entry")).toBe(1);

  await page.locator("#intro").click({ clickCount: 3 });
  await expect.poll(() => countClosedShadow(page, ".entry")).toBe(2);

  await page.mouse.click(5, 5);
  await page.keyboard.press("Escape");
  expect(await countClosedShadow(page, ".card")).toBe(1);

  const close = await queryClosedShadow(page, "button[aria-label='Close']");
  if (!close) throw new Error("close button missing");
  await page.mouse.click(close.center.x, close.center.y);
  await expect.poll(() => countClosedShadow(page, ".card")).toBe(0);
});

test("one-shot card drags by its head, survives a click in the safe zone and closes far away", async ({
  paired,
  mock,
}) => {
  const page = await paired.context.newPage();
  await page.goto(`${mock.url}/fixtures/article.html`);

  await page.locator("#sel").click({ clickCount: 3 });
  await expect.poll(() => queryClosedShadow(page, "button.icon")).not.toBeNull();
  const icon = await queryClosedShadow(page, "button.icon");
  if (!icon) throw new Error("icon disappeared");
  await page.mouse.click(icon.center.x, icon.center.y);
  await expect.poll(() => queryClosedShadow(page, ".card .scroll")).not.toBeNull();

  const before = await queryClosedShadow(page, ".card");
  // the language label fills the free part of the head; the select and buttons do not start a drag
  const head = await queryClosedShadow(page, ".head .lang");
  if (!before || !head) throw new Error("card missing");
  const grab = { x: head.box.x + head.box.width / 2, y: head.box.y + head.box.height / 2 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + 25, grab.y + 15, { steps: 4 });
  await page.mouse.move(grab.x + 50, grab.y + 30, { steps: 4 });
  await page.mouse.up();

  const moved = await queryClosedShadow(page, ".card");
  if (!moved) throw new Error("card missing after drag");
  expect(Math.round(moved.box.x - before.box.x)).toBe(50);
  expect(Math.round(moved.box.y - before.box.y)).toBe(30);

  await page.mouse.click(moved.box.x - 10, moved.box.y + moved.box.height / 2);
  expect(await countClosedShadow(page, ".card")).toBe(1);

  await page.mouse.click(5, 5);
  await expect.poll(() => countClosedShadow(page, ".card")).toBe(0);
});

async function selectInIntro(page: Page) {
  await page.evaluate(() => {
    const link = document.getElementById("docs-link") as HTMLElement;
    const after = link.nextSibling as Text;
    const range = document.createRange();
    range.setStart(link.firstChild as Text, 4);
    range.setEnd(after, after.data.indexOf("before") + "before".length);
    const sel = getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
}

async function insertFromCard(page: Page) {
  await selectInIntro(page);
  await expect.poll(() => queryClosedShadow(page, "button.icon")).not.toBeNull();
  const icon = await queryClosedShadow(page, "button.icon");
  if (!icon) throw new Error("icon disappeared");
  await page.mouse.click(icon.center.x, icon.center.y);
  await expect.poll(() => queryClosedShadow(page, ".card .scroll")).not.toBeNull();
  const insert = await queryClosedShadow(page, "button[aria-label='Insert into the page']");
  if (!insert) throw new Error("insert button missing");
  await page.mouse.click(insert.center.x, insert.center.y);
}

test("insert button translates the selection in place and keeps the link", async ({
  paired,
  mock,
}) => {
  const page = await paired.context.newPage();
  await page.goto(`${mock.url}/fixtures/article.html`);
  const intro = page.locator("#intro");

  await insertFromCard(page);

  await expect.poll(async () => (await intro.textContent())?.includes("[ru] ")).toBe(true);
  await expect(page.locator("#intro a")).toHaveCount(1);
  await expect(page.locator("#docs-link")).toHaveAttribute("href", "/fixtures/other.html");
  expect(await intro.textContent()).toContain(
    "The event loop lets the runtime handle many connections at once.",
  );
});

test("revert button restores the original html", async ({ paired, mock }) => {
  const page = await paired.context.newPage();
  await page.goto(`${mock.url}/fixtures/article.html`);
  const intro = page.locator("#intro");
  const original = await intro.innerHTML();

  await insertFromCard(page);
  await expect.poll(async () => (await intro.textContent())?.includes("[ru] ")).toBe(true);

  await expect
    .poll(() => queryClosedShadow(page, "button.revert[aria-label]", "revert"))
    .not.toBeNull();
  const revert = await queryClosedShadow(page, "button.revert", "revert");
  if (!revert) throw new Error("revert button missing");
  await page.mouse.click(revert.center.x, revert.center.y);

  await expect.poll(() => intro.innerHTML()).toBe(original);
});
