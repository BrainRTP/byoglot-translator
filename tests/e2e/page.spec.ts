import type { Page } from "@playwright/test";
import { openPopup } from "./extension";
import { expect, test } from "./fixtures";

const sourceHtml = (page: Page) => page.locator("#content").innerHTML();

test("translates the page, keeps the link alive and restores the exact original", async ({
  paired,
  mock,
}) => {
  const page = await paired.context.newPage();
  await page.goto(`${mock.url}/fixtures/article.html`);
  await page.evaluate(() => {
    (window as unknown as { __link: Element }).__link = document.querySelector(
      "#docs-link",
    ) as Element;
  });
  const before = await sourceHtml(page);

  const popup = await openPopup(paired, page);
  await popup.getByRole("button", { name: "Translate page" }).click();

  await expect(page.locator("#intro")).toContainText("[ru] ", { timeout: 15_000 });
  await expect(page.locator("#sel")).toContainText("[ru] A small sentence");
  await expect(page.locator("li").first()).toContainText("[ru] Callbacks run");

  const link = page.locator("#docs-link");
  await expect(link).toHaveText("the official docs");
  await expect(link).toHaveAttribute("href", "/fixtures/other.html");
  await expect(link).toHaveAttribute("title", "More details");
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __link: Element }).__link === document.querySelector("#docs-link"),
    ),
  ).toBe(true);
  await expect(page.locator("#intro code")).toHaveText("node index.js");

  const generate = mock.requests.filter((r) => r.path === "/api/experimental/generate/text");
  expect(generate.length).toBeGreaterThan(0);
  expect(generate.every((r) => r.authorized)).toBe(true);

  await popup.getByRole("button", { name: "Show original" }).click();
  await expect.poll(() => sourceHtml(page)).toBe(before);

  await popup.getByRole("button", { name: "Translate page" }).click();
  await expect(page.locator("#intro")).toContainText("[ru] ");
  await page.locator("#docs-link").click();
  await expect(page).toHaveURL(`${mock.url}/fixtures/other.html`);
  await expect(page.locator("#other")).toBeVisible();
});

test("translates a modal that the page adds one second later", async ({ paired, mock }) => {
  const page = await paired.context.newPage();
  await page.goto(`${mock.url}/fixtures/dynamic.html`);
  const popup = await openPopup(paired, page);
  await popup.getByRole("button", { name: "Translate page" }).click();
  await expect(page.locator("#static")).toContainText("[ru] ", { timeout: 15_000 });

  await page.waitForTimeout(1000);
  await page.evaluate(() => (window as unknown as { openModal(): void }).openModal());
  await expect(page.locator("#modal-text")).toHaveText(
    "[ru] Do you really want to leave this page now?",
  );
});
