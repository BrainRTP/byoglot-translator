import { openPopup } from "./extension";
import { expect, test } from "./fixtures";

test.describe("rate limit", () => {
  test.use({ mockMode: "rate_limit" });

  test("popup shows the limit error with the time until reset", async ({ paired, mock }) => {
    const page = await paired.context.newPage();
    await page.goto(`${mock.url}/fixtures/article.html`);
    const popup = await openPopup(paired, page);
    await popup.getByRole("button", { name: "Translate page" }).click();

    const alert = popup.getByRole("alert");
    await expect(alert).toContainText("Provider limit reached", { timeout: 15_000 });
    await expect(alert).toContainText(/Resets in 1 h 24 min \(at \d{2}:\d{2}\)/);
    await expect(page.locator("#intro")).not.toContainText("[ru]");
  });
});
