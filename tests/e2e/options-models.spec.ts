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

test("OpenAI without a default model lets the user choose and translate", async ({ ext }) => {
  const provider = await startMockProvider();
  try {
    await seedProvider(ext.worker, provider);
    await ext.worker.evaluate(async () => {
      const { connections } = await chrome.storage.local.get("connections");
      const connection = (connections as Record<string, unknown>[])[0];
      await chrome.storage.local.set({
        connections: [{ ...connection, preset: "openai", pageModel: null, selectionModel: null }],
      });
    });
    const translator = await ext.context.newPage();
    await translator.goto(`chrome-extension://${ext.id}/translator.html`);
    await translator.getByRole("textbox", { name: "Text to translate", exact: true }).fill("Hello");
    await translator.getByRole("button", { name: "Translate", exact: true }).click();
    await expect(
      translator.getByRole("alert").filter({ hasText: "No model chosen" }),
    ).toContainText("Choose a model in settings");
    const options = await ext.context.newPage();
    await options.goto(`chrome-extension://${ext.id}/options.html`);
    for (const name of ["Page translation: Model", "Selection translation: Model"]) {
      const picker = options.getByRole("combobox", { name });
      await expect(picker).toBeEnabled();
      await expect(picker).toHaveValue("");
      await picker.selectOption({ label: "DeepSeek-V4.1-Flash" });
    }
    await translator.getByRole("button", { name: "Translate", exact: true }).click();
    await expect(translator.getByLabel("Translation", { exact: true })).toContainText("[ru] Hello");
  } finally {
    await provider.stop();
  }
});
