import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { openPopup } from "../extension";
import { expect, test } from "../fixtures";
import { queryClosedShadow } from "../shadow";

const SHOTS = "/tmp/byoglot-live";
const CYRILLIC = /\p{Script=Cyrillic}/u;
const FIRST_PARAGRAPH = "#mw-content-text .mw-parser-output p:not(.mw-empty-elt)";

const opencode = (...args: string[]) => execFileSync("opencode", args, { encoding: "utf8" }).trim();

async function timed<T>(label: string, run: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await run();
  } finally {
    console.log(`[live] ${label}: ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
}

async function firstParagraphText(page: Page): Promise<string> {
  return (await page.locator(FIRST_PARAGRAPH).first().textContent()) ?? "";
}

test.skip(
  !process.env.BYOGLOT_LIVE,
  "set BYOGLOT_LIVE=1 (pnpm e2e:live) to run against a real opencode",
);

test("translates a real article through the local opencode", async ({ ext }) => {
  mkdirSync(SHOTS, { recursive: true });

  const url = new URL(opencode("service", "status")).origin;
  const { code } = JSON.parse(opencode("api", "POST", "/api/pair")) as { code: string };

  await timed("pairing", async () => {
    const onboarding = await ext.context.newPage();
    await onboarding.goto(`chrome-extension://${ext.id}/onboarding.html`);
    await onboarding.getByLabel("Connection link").fill(`${url}/auth/connect/${code}`);
    await onboarding.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(onboarding.getByText("Connected", { exact: true })).toBeVisible();
    await onboarding.close();
  });

  await ext.worker.evaluate(async () => {
    const model = { providerID: "deepseek", id: "deepseek-flash", variant: "none" };
    await chrome.storage.local.set({
      globals: {
        sourceLang: "auto",
        targetLang: "ru",
        displayMode: "replace",
        pageModel: model,
        selectionModel: model,
        defaultTemplateId: "builtin-default",
        uiLang: "en",
      },
    });
  });

  const page = await ext.context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("https://wikipedia.org/wiki/Node.js", { waitUntil: "load" });
  await expect(page.locator(FIRST_PARAGRAPH).first()).toBeVisible();
  expect(await firstParagraphText(page)).not.toMatch(CYRILLIC);
  // Wikipedia scripts touch the page when a screenshot is taken, so the baseline is read after it
  await page.screenshot({ path: `${SHOTS}/1-original.png` });
  await page.waitForTimeout(1500);

  const article = page.locator("#mw-content-text");
  const before = await article.innerHTML();
  const link = page.locator(`${FIRST_PARAGRAPH} a[title="JavaScript"]`).first();
  const href = await link.getAttribute("href");
  expect(href).toBeTruthy();
  await link.evaluate((el) => {
    (window as unknown as { __link: Element }).__link = el;
  });

  const popup = await openPopup(ext, page);
  await popup.getByRole("button", { name: "Translate page" }).click();

  await timed("first paragraph translated", () =>
    expect.poll(() => firstParagraphText(page), { timeout: 90_000 }).toMatch(CYRILLIC),
  );
  await page.screenshot({ path: `${SHOTS}/2-translated-first-paragraph.png` });

  await timed("whole page translated", () =>
    expect(popup.getByRole("progressbar")).toBeHidden({ timeout: 150_000 }),
  );
  await expect(popup.getByRole("button", { name: "Show original" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/3-translated.png` });

  const linkAfter = page.locator(`${FIRST_PARAGRAPH} a[href="${href}"]`).first();
  await expect(linkAfter).toHaveAttribute("href", href as string);
  expect(
    await linkAfter.evaluate((el) => (window as unknown as { __link: Element }).__link === el),
  ).toBe(true);

  await popup.getByRole("button", { name: "Show original" }).click();
  try {
    await expect
      .poll(async () => (await article.innerHTML()) === before, { timeout: 15_000 })
      .toBe(true);
  } catch (error) {
    writeFileSync(`${SHOTS}/article-before.html`, before);
    writeFileSync(`${SHOTS}/article-after.html`, await article.innerHTML());
    throw error;
  }
  expect(await firstParagraphText(page)).not.toMatch(CYRILLIC);
  await page.screenshot({ path: `${SHOTS}/4-restored.png` });

  await page.bringToFront();
  const sentence = await page
    .locator(FIRST_PARAGRAPH)
    .first()
    .evaluate((p) => {
      const stop = (p.textContent ?? "").indexOf(". ") + 1;
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      range.setStart(p, 0);
      let seen = 0;
      for (
        let node = walker.nextNode() as Text | null;
        node;
        node = walker.nextNode() as Text | null
      ) {
        if (seen + node.data.length >= stop) {
          range.setEnd(node, stop - seen);
          break;
        }
        seen += node.data.length;
      }
      const sel = getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      return range.toString();
    });
  expect(sentence.length).toBeGreaterThan(40);

  await expect.poll(() => queryClosedShadow(page, "button.icon"), { timeout: 5000 }).not.toBeNull();
  const icon = await queryClosedShadow(page, "button.icon");
  if (!icon) throw new Error("selection icon disappeared");
  await page.mouse.click(icon.center.x, icon.center.y);

  await timed("selection card", () =>
    expect
      .poll(async () => (await queryClosedShadow(page, ".card .scroll"))?.text ?? "", {
        timeout: 60_000,
      })
      .toMatch(CYRILLIC),
  );
  await page.screenshot({ path: `${SHOTS}/5-selection-card.png` });

  await page.keyboard.press("Escape");
  await page.locator(`${FIRST_PARAGRAPH} a[href="${href}"]`).first().click();
  await expect(page).toHaveURL(href as string);
});
