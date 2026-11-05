import { openPopup } from "./extension";
import { expect, test } from "./fixtures";

test("the theme choice applies at once, survives a reload and reaches the popup", async ({
  paired,
  mock,
}) => {
  const page = await paired.context.newPage();
  await page.goto(`chrome-extension://${paired.id}/options.html`);
  const group = page.getByRole("group", { name: "Theme" });
  const html = page.locator("html");

  await group.getByRole("button", { name: "Dark" }).click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("#language .flag")).toHaveText("Saved");

  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(group.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");

  await group.getByRole("button", { name: "System" }).click();
  await expect(html).not.toHaveAttribute("data-theme", /.*/);

  await group.getByRole("button", { name: "Light" }).click();
  await expect(html).toHaveAttribute("data-theme", "light");

  const tab = await paired.context.newPage();
  await tab.goto(`${mock.url}/fixtures/article.html`);
  const popup = await openPopup(paired, tab);
  await expect(popup.locator("html")).toHaveAttribute("data-theme", "light");
});
