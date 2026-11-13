import { seedProvider } from "./extension";
import { expect, test } from "./fixtures";
import { startMockProvider } from "./mock-provider";

test("opens the translator from options, translates at 320px, and reuses its tab", async ({
  paired,
  mock,
}) => {
  const options = await paired.context.newPage();
  await options.goto(`chrome-extension://${paired.id}/options.html`);
  const opened = paired.context.waitForEvent("page");
  await options.getByRole("link", { name: "Translate text", exact: true }).click();
  expect(
    (await options.getByRole("link", { name: "Translate text", exact: true }).boundingBox())
      ?.height,
  ).toBeGreaterThanOrEqual(44);
  const translator = await opened;
  await translator.waitForURL(`chrome-extension://${paired.id}/translator.html`);
  await translator.addInitScript(() => {
    chrome.runtime.getPlatformInfo = async () => ({ os: "android", arch: "arm", nacl_arch: "arm" });
  });
  await translator.setViewportSize({ width: 320, height: 800 });
  await translator.reload();
  const input = translator.getByRole("textbox", { name: "Text to translate", exact: true });
  const translate = translator.getByRole("button", { name: "Translate", exact: true });
  await expect(translate).toBeDisabled();
  await expect(translator.getByLabel("Source language")).toHaveValue("auto");
  await expect(translator.getByLabel("Target language")).toHaveValue("ru");
  await input.fill("x".repeat(20_001));
  await expect(translator.getByRole("alert")).toContainText("Text is too long (20001 / 20000)");
  await expect(translate).toBeDisabled();
  await input.fill("Hello from the translator");
  await translate.click();
  await expect(translator.getByLabel("Translation", { exact: true })).toContainText(
    "[ru] Hello from the translator",
  );
  await expect(translator.getByRole("button", { name: "Copy", exact: true })).toBeEnabled();
  await expect(translator.getByRole("status")).toContainText("does not report whether");
  const requests = mock.requests.filter(
    (request) => request.path === "/api/experimental/generate/text",
  );
  expect(requests).toHaveLength(1);
  const request = requests[0];
  if (!request) throw new Error("No translation request");
  const { prompt } = request.body as { prompt: string };
  expect(prompt).toContain("The text comes from the app ByoGlot Translator.");
  expect(prompt).not.toContain("CONTEXT");
  expect(await translator.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  for (const control of await translator.locator("button, select").all()) {
    expect((await control.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
  await translator.screenshot({ path: test.info().outputPath("translator-320.png") });
  await options.bringToFront();
  await options.getByRole("link", { name: "Translate text", exact: true }).click();
  await expect(input).toHaveValue("Hello from the translator");
  expect(
    paired.context.pages().filter((page) => page.url().endsWith("/translator.html")),
  ).toHaveLength(1);
  const popup = await paired.context.newPage();
  await popup.goto(`chrome-extension://${paired.id}/popup.html`);
  await popup.getByRole("button", { name: "Translate text", exact: true }).click();
  await expect.poll(() => popup.isClosed()).toBe(true);
  expect(
    paired.context.pages().filter((page) => page.url().endsWith("/translator.html")),
  ).toHaveLength(1);
  const storage = await paired.worker.evaluate(() => chrome.storage.local.get(null));
  expect(JSON.stringify(storage)).not.toContain("Hello from the translator");
  await translator.reload();
  await expect(input).toHaveValue("");
});

test("keeps truncated output visible with a warning", async ({ ext }) => {
  const provider = await startMockProvider({ mode: "length" });
  try {
    await seedProvider(ext.worker, provider);
    const page = await ext.context.newPage();
    await page.goto(`chrome-extension://${ext.id}/translator.html`);
    await page.getByRole("textbox", { name: "Text to translate", exact: true }).fill("A long text");
    await page.getByRole("button", { name: "Translate", exact: true }).click();
    await expect(page.getByLabel("Translation", { exact: true })).toContainText("[ru] A long text");
    await expect(page.getByRole("status")).toContainText("translation was cut off");
    await expect(page.getByRole("button", { name: "Copy", exact: true })).toBeEnabled();
  } finally {
    await provider.stop();
  }
});

test("closing the translator tab aborts its provider request", async ({ ext }) => {
  const provider = await startMockProvider({ mode: "slow" });
  try {
    await seedProvider(ext.worker, provider);
    const page = await ext.context.newPage();
    await page.goto(`chrome-extension://${ext.id}/translator.html`);
    await page
      .getByRole("textbox", { name: "Text to translate", exact: true })
      .fill("Slow request");
    await page.getByRole("button", { name: "Translate", exact: true }).click();
    await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeEnabled();
    await expect
      .poll(
        () => provider.requests.filter((request) => request.path === "/v1/chat/completions").length,
      )
      .toBe(1);
    await page.close();
    await expect.poll(() => provider.aborted).toBe(1);
  } finally {
    await provider.stop();
  }
});
