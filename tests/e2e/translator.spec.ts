import { expect, test } from "./fixtures";

test("opens the translator from options, translates at 320px, and reuses its tab", async ({
  paired,
  mock,
}) => {
  const options = await paired.context.newPage();
  await options.goto(`chrome-extension://${paired.id}/options.html`);
  const opened = paired.context.waitForEvent("page");
  await options.getByRole("link", { name: "Translate text", exact: true }).click();
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
  await expect(translator.getByRole("alert")).toContainText("20000 character limit");
  await expect(translate).toBeDisabled();
  await input.fill("Hello from the translator");
  await translate.click();
  await expect(translator.getByLabel("Translation", { exact: true })).toContainText(
    "[ru] Hello from the translator",
  );
  await expect(translator.getByRole("button", { name: "Copy", exact: true })).toBeEnabled();
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
