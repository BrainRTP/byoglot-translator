import type { Page } from "@playwright/test";
import type { Extension } from "./extension";
import { expect, test } from "./fixtures";

async function openAnimation(ext: Extension): Promise<Page> {
  const page = await ext.context.newPage();
  await page.goto(`chrome-extension://${ext.id}/options.html`);
  await expect(page.getByRole("radiogroup", { name: "Animation effect" })).toBeVisible();
  return page;
}

type Stored = { animation: string; displayMode: string };

const stored = (ext: Extension): Promise<Stored> =>
  ext.worker.evaluate(async () => (await chrome.storage.local.get("globals")).globals as Stored);

test("clicking a card saves the animation and checks it", async ({ paired }) => {
  const page = await openAnimation(paired);
  const pen = page.getByRole("radio", { name: /^Pen/ });
  await expect(pen).toHaveAttribute("aria-checked", "false");

  await pen.click();

  await expect(pen).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { checked: true })).toHaveCount(1);
  await expect.poll(async () => (await stored(paired)).animation).toBe("pen");
  await expect(page.locator("#animation .flag")).toHaveText("Saved");
});

test("arrow keys move the selection and the focus", async ({ paired }) => {
  const page = await openAnimation(paired);
  const radios = page.getByRole("radio");
  await page.getByRole("radio", { name: /^None/ }).click();
  await expect(radios.first()).toHaveAttribute("aria-checked", "true");

  await page.keyboard.press("ArrowRight");
  const second = radios.nth(1);
  await expect(second).toHaveAttribute("aria-checked", "true");
  await expect(second).toBeFocused();
  await expect(second).toHaveAttribute("tabindex", "0");
  await expect(radios.first()).toHaveAttribute("tabindex", "-1");
  await expect.poll(async () => (await stored(paired)).animation).toBe("fade");

  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(radios.last()).toHaveAttribute("aria-checked", "true");
  await expect(radios.last()).toBeFocused();
});

test("the stage mode is local and does not touch the display mode", async ({ paired }) => {
  const page = await openAnimation(paired);
  await page.getByRole("button", { name: "Bilingual" }).click();
  await expect(page.locator("#animation article [data-oct]")).toHaveCount(4);
  await page.getByRole("button", { name: "Replace" }).click();
  await expect(page.locator("#animation article [data-oct]")).toHaveCount(0);
  expect((await stored(paired)).displayMode).toBe("replace");
});

test("the reduced motion banner follows the system setting", async ({ paired }) => {
  const page = await openAnimation(paired);
  const note = page.getByRole("note");
  await expect(note).toHaveCount(0);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(note).toContainText("reduce motion");

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(note).toHaveCount(0);
});
