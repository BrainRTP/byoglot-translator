import { seedProvider } from "./extension";
import { expect, test } from "./fixtures";
import { startMockProvider } from "./mock-provider";

test("the options page opens before a slow model list and spins only the model fields", async ({
  ext,
}) => {
  const provider = await startMockProvider({ modelsDelayMs: 3000 });
  try {
    await seedProvider(ext.worker, provider);
    const page = await ext.context.newPage();
    await page.goto(`chrome-extension://${ext.id}/options.html`);
    const model = page.getByRole("combobox", { name: "Page translation: Model" });
    await expect(page.getByRole("group", { name: "Theme" })).toBeVisible({ timeout: 1000 });
    await expect(model).toBeDisabled();
    await expect(page.locator("#models .ms.loading .spin").first()).toBeVisible();
    await expect(model).toBeEnabled({ timeout: 10_000 });
    await expect(page.locator("#models .spin")).toHaveCount(0);
  } finally {
    await provider.stop();
  }
});
