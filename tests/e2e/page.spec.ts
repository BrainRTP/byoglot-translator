import { readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { openPopup } from "./extension";
import { expect, test } from "./fixtures";
import type { MockOpencode } from "./mock-opencode";
import { NO_PROFILE_LANG, PROFILES_DIR } from "./profile-files";

function firstLine(profile: string): string {
  const [line] = readFileSync(path.join(PROFILES_DIR, `${profile}.md`), "utf8")
    .trim()
    .split("\n");
  return line as string;
}

function generatedPrompts(mock: MockOpencode): string[] {
  return mock.requests
    .filter((r) => r.path === "/api/experimental/generate/text")
    .map((r) => (r.body as { prompt: string }).prompt);
}

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
  await expect(page.locator("#pic")).toHaveAttribute("alt", "[ru] A sleeping cat");
  await expect(page.locator("#q")).toHaveAttribute("placeholder", "[ru] Search the docs");
  await expect(page.locator("#sel")).toHaveAttribute("title", "[ru] A sentence to select");
  await expect(link).toHaveText("the official docs");
  await expect(link).toHaveAttribute("href", "/fixtures/other.html");
  await expect(link).toHaveAttribute("title", "[ru] More details");
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

test("page prompt carries the Russian language profile for a Russian target", async ({
  paired,
  mock,
}) => {
  const page = await paired.context.newPage();
  await page.goto(`${mock.url}/fixtures/article.html`);
  const popup = await openPopup(paired, page);
  await popup.getByRole("button", { name: "Translate page" }).click();
  await expect(page.locator("#intro")).toContainText("[ru] ", { timeout: 15_000 });

  const prompts = generatedPrompts(mock);
  expect(prompts.length).toBeGreaterThan(0);
  for (const prompt of prompts) {
    expect(prompt).toContain("LANGUAGE STYLE");
    expect(prompt).toContain(firstLine("ru"));
    expect(prompt).not.toContain(firstLine("generic"));
  }
});

test("page prompt carries the generic language profile for a target without its own", async ({
  paired,
  mock,
}) => {
  await paired.worker.evaluate(async (targetLang) => {
    const { globals } = await chrome.storage.local.get("globals");
    await chrome.storage.local.set({ globals: { ...(globals as object), targetLang } });
  }, NO_PROFILE_LANG);
  const page = await paired.context.newPage();
  await page.goto(`${mock.url}/fixtures/article.html`);
  const popup = await openPopup(paired, page);
  await popup.getByRole("button", { name: "Translate page" }).click();
  await expect(page.locator("#intro")).toContainText("[ru] ", { timeout: 15_000 });

  const prompts = generatedPrompts(mock);
  expect(prompts.length).toBeGreaterThan(0);
  for (const prompt of prompts) {
    expect(prompt).toContain("LANGUAGE STYLE");
    expect(prompt).toContain(firstLine("generic"));
    expect(prompt).not.toContain(firstLine("ru"));
  }
});

const watchProgressBar = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __bar: boolean };
    w.__bar = false;
    new MutationObserver((records) => {
      for (const r of records)
        for (const n of r.addedNodes)
          if ((n as Element).getAttribute?.("data-byoglot") === "progress") w.__bar = true;
    }).observe(document.documentElement, { childList: true });
  });

const barSeen = (page: Page) =>
  page.evaluate(() => (window as unknown as { __bar: boolean }).__bar);

test("shows a progress bar while translating and removes it afterwards", async ({
  paired,
  mock,
}) => {
  const page = await paired.context.newPage();
  await page.goto(`${mock.url}/fixtures/article.html`);
  await watchProgressBar(page);

  const popup = await openPopup(paired, page);
  await popup.getByRole("button", { name: "Translate page" }).click();
  await expect(page.locator("#intro")).toContainText("[ru] ", { timeout: 15_000 });

  await expect.poll(() => barSeen(page)).toBe(true);
  await expect(page.locator('[data-byoglot="progress"]')).toHaveCount(0);
});

test("does not show the progress bar when it is turned off", async ({ paired, mock }) => {
  await paired.worker.evaluate(async () => {
    const { globals } = await chrome.storage.local.get("globals");
    await chrome.storage.local.set({ globals: { ...(globals as object), progressBar: false } });
  });
  const page = await paired.context.newPage();
  await page.goto(`${mock.url}/fixtures/article.html`);
  await watchProgressBar(page);

  const popup = await openPopup(paired, page);
  await popup.getByRole("button", { name: "Translate page" }).click();
  await expect(page.locator("#intro")).toContainText("[ru] ", { timeout: 15_000 });
  await page.waitForTimeout(600);

  expect(await barSeen(page)).toBe(false);
});
