import { openPopup, seedProvider } from "./extension";
import { expect, test } from "./fixtures";
import { startMockProvider } from "./mock-provider";

test("model and mode rows share the same columns", async ({ paired, mock }) => {
  const page = await paired.context.newPage();
  await page.goto(`${mock.url}/fixtures/article.html`);
  const popup = await openPopup(paired, page);

  const effort = popup.getByRole("combobox", { name: "Effort" });
  const lang = popup.getByRole("combobox", { name: "Translate to" });
  await expect(lang).toBeVisible();

  const [a, b] = await Promise.all([effort.boundingBox(), lang.boundingBox()]);
  expect(a?.x).toBe(b?.x);
  expect(a?.width).toBe(b?.width);
});

test("the effort list opens under its field and stays inside the popup", async ({
  paired,
  mock,
}) => {
  const page = await paired.context.newPage();
  await page.goto(`${mock.url}/fixtures/article.html`);
  const popup = await openPopup(paired, page);

  const effort = popup.getByRole("combobox", { name: "Effort" });
  await effort.click();
  const first = effort.getByRole("option").first();
  await expect(first).toBeVisible();

  const field = await effort.boundingBox();
  const option = await first.boundingBox();
  if (!field || !option) throw new Error("no boxes");
  const width = popup.viewportSize()?.width ?? 0;
  const below = option.y >= field.y + field.height;
  const above = option.y + option.height <= field.y;
  expect(below || above).toBe(true);
  expect(option.x).toBeGreaterThanOrEqual(field.x);
  expect(option.x + option.width).toBeLessThanOrEqual(width);
});

test("the popup is usable before a slow status check returns", async ({ ext, mock }) => {
  const provider = await startMockProvider({ modelsDelayMs: 3000 });
  try {
    await seedProvider(ext.worker, provider);
    const page = await ext.context.newPage();
    await page.goto(`${mock.url}/fixtures/article.html`);
    const popup = await openPopup(ext, page);
    await expect(popup.getByRole("button", { name: "Translate page" })).toBeEnabled({
      timeout: 1000,
    });
    expect((await popup.locator("main.pop").boundingBox())?.width).toBe(360);
    await expect(popup.getByText("Checking...")).toBeVisible();
    await expect(popup.getByText("Connected", { exact: true })).toBeVisible({ timeout: 10_000 });
  } finally {
    await provider.stop();
  }
});

test("a failing model list still shows the settings", async ({ paired, mock }) => {
  const page = await paired.context.newPage();
  await page.goto(`${mock.url}/fixtures/article.html`);
  const popup = await openPopup(paired, page, () => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = ((msg: { type?: string }, cb: (r: unknown) => void) => {
      if (msg?.type !== "models") return send(msg, cb);
      Object.defineProperty(chrome.runtime, "lastError", {
        configurable: true,
        get: () => ({ message: "e2e" }),
      });
      cb(undefined);
      Reflect.deleteProperty(chrome.runtime, "lastError");
      (window as unknown as { modelsRejected: boolean }).modelsRejected = true;
    }) as never;
  });
  await popup.waitForFunction(
    () => (window as unknown as { modelsRejected?: boolean }).modelsRejected,
  );
  await expect(popup.getByRole("combobox", { name: "Translate to" })).toBeVisible();
  await expect(popup.getByRole("combobox", { name: "Model" })).toBeVisible();
  await expect(popup.getByRole("combobox", { name: "Model" }).locator("optgroup")).toHaveCount(0);
  await expect(popup.getByText("Could not load the popup")).toHaveCount(0);
});

test("popup switches the selection mode", async ({ paired, mock }) => {
  const page = await paired.context.newPage();
  await page.goto(`${mock.url}/fixtures/article.html`);
  const popup = await openPopup(paired, page);
  const group = popup.getByRole("group", { name: "Selection translation" });
  await group.getByRole("button", { name: "In place" }).click();
  await expect(group.getByRole("button", { name: "In place" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const options = await paired.context.newPage();
  await options.goto(`chrome-extension://${paired.id}/options.html`);
  const saved = options.getByRole("group", { name: "Selection translation" });
  await expect(saved.getByRole("button", { name: "In place" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
