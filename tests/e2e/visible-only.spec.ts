import { openPopup } from "./extension";
import { expect, test } from "./fixtures";

test("translates collapsed content only after it is opened", async ({ paired, mock }) => {
  await paired.worker.evaluate(() =>
    chrome.storage.local.set({
      templates: [
        {
          id: "builtin-default",
          name: "Plain translation",
          builtin: true,
          settings: { prePrompt: "Translate.", visibleOnly: true },
        },
      ],
    }),
  );
  const page = await paired.context.newPage();
  await page.goto(`${mock.url}/fixtures/details.html`);
  const popup = await openPopup(paired, page);
  await popup.getByRole("button", { name: "Translate page" }).click();

  await expect(page.locator("#shown")).toContainText("[ru] ", { timeout: 15_000 });
  await page.waitForTimeout(500);
  await expect(page.locator("#hidden")).toHaveText(
    "This paragraph stays collapsed until it is opened.",
  );

  await page.locator("#more summary").click();
  await expect(page.locator("#hidden")).toContainText("[ru] ", { timeout: 15_000 });
});
