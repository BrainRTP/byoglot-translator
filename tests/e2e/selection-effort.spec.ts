import type { Page } from "@playwright/test";
import type { Extension } from "./extension";
import { expect, test } from "./fixtures";

async function openModels(ext: Extension): Promise<Page> {
  const page = await ext.context.newPage();
  await page.goto(`chrome-extension://${ext.id}/options.html`);
  await expect(page.getByRole("group", { name: /Effort: Pinned/ })).toBeVisible();
  return page;
}

const globals = (ext: Extension) =>
  ext.worker.evaluate(
    async () =>
      (await chrome.storage.local.get("globals")).globals as { pinnedEffort: string | null },
  );

test("pinned and one-shot effort are separate and survive a reload", async ({ paired }) => {
  const page = await openModels(paired);
  const pinned = page.getByRole("group", { name: /Effort: Pinned/ });
  const oneShot = page.getByRole("group", { name: /Effort: One-shot/ });
  await expect(pinned.getByRole("button", { name: "high" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await pinned.getByRole("button", { name: "medium" }).click();
  await oneShot.getByRole("button", { name: "low" }).click();
  await expect.poll(async () => (await globals(paired)).pinnedEffort).toBe("medium");

  await page.reload();
  const again = await openModels(paired);
  await expect(
    again.getByRole("group", { name: /Effort: Pinned/ }).getByRole("button", { name: "medium" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    again.getByRole("group", { name: /Effort: One-shot/ }).getByRole("button", { name: "low" }),
  ).toHaveAttribute("aria-pressed", "true");
});
