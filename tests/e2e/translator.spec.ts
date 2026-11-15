import { seedProvider } from "./extension";
import { expect, test } from "./fixtures";
import { startMockProvider } from "./mock-provider";

test("keeps an initial load error through failed focus refreshes and restores saved languages on recovery", async ({
  paired,
}) => {
  const page = await paired.context.newPage();
  await page.addInitScript(() => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    let failures = 0;
    chrome.runtime.sendMessage = ((msg: { type?: string }, cb: (r: unknown) => void) => {
      if (msg?.type !== "globals" || failures++ >= 2) return send(msg, cb);
      Object.defineProperty(chrome.runtime, "lastError", {
        configurable: true,
        get: () => ({ message: "e2e" }),
      });
      cb(undefined);
      Reflect.deleteProperty(chrome.runtime, "lastError");
    }) as never;
  });
  await page.goto(`chrome-extension://${paired.id}/translator.html`);
  const retry = page.getByRole("button", { name: "Retry", exact: true });
  await expect(retry).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(retry).toBeVisible();
  await expect(page.getByLabel("Target language")).toHaveCount(0);
  await retry.click();
  await expect(page.getByLabel("Target language")).toHaveValue("ru");
});

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
  await expect(translate).toBeDisabled();
  await input.fill("Hello from the translator!");
  await expect(translate).toBeEnabled();
  await input.fill("Hello from the translator");
  await expect(translate).toBeDisabled();
  await expect(translator.getByLabel("Translation", { exact: true })).toContainText(
    "[ru] Hello from the translator",
  );
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

test("refreshes edited and deleted templates without losing editor text", async ({ paired }) => {
  const page = await paired.context.newPage();
  await page.goto(`chrome-extension://${paired.id}/translator.html`);
  const input = page.getByRole("textbox", { name: "Text to translate", exact: true });
  await input.fill("Keep this text");
  const builtin = { id: "builtin-default", name: "Plain", builtin: true, settings: {} };
  const custom = { id: "custom", name: "Custom", builtin: false, settings: { targetLang: "de" } };
  await paired.worker.evaluate(
    (templates) => chrome.storage.local.set({ templates }),
    [builtin, custom],
  );
  const picker = page.getByLabel("Template");
  await expect(picker.locator("option")).toHaveCount(2);
  await picker.selectOption("custom");
  const translate = page.getByRole("button", { name: "Translate", exact: true });
  await translate.click();
  await expect(translate).toBeDisabled();
  await paired.worker.evaluate(
    (templates) => chrome.storage.local.set({ templates }),
    [builtin, { ...custom, name: "Edited", settings: { targetLang: "ja" } }],
  );
  await expect(picker.locator("option:checked")).toHaveText("Edited");
  await expect(page.getByLabel("Target language")).toHaveValue("ja");
  await expect(translate).toBeEnabled();
  await expect(input).toHaveValue("Keep this text");
  await paired.worker.evaluate((templates) => chrome.storage.local.set({ templates }), [builtin]);
  await expect(picker).toHaveValue("builtin-default");
  await expect(picker.locator("option")).toHaveCount(1);
  await expect(input).toHaveValue("Keep this text");
});

test("ignores an older template refresh after the latest response", async ({ paired }) => {
  const page = await paired.context.newPage();
  await page.addInitScript(() => {
    const state = window as unknown as {
      holdTemplates: boolean;
      responses: { callback(response: unknown): void; response: unknown }[];
    };
    state.holdTemplates = false;
    state.responses = [];
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = ((
      msg: { type?: string },
      callback: (response: unknown) => void,
    ) => {
      if (msg?.type !== "templates" || !state.holdTemplates) return send(msg, callback);
      return send(msg, (response) => state.responses.push({ callback, response }));
    }) as never;
  });
  await page.goto(`chrome-extension://${paired.id}/translator.html`);
  const picker = page.getByLabel("Template");
  await expect(picker).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { holdTemplates: boolean }).holdTemplates = true;
  });
  const builtin = { id: "builtin-default", name: "Plain", builtin: true, settings: {} };
  await paired.worker.evaluate(
    (templates) => chrome.storage.local.set({ templates }),
    [builtin, { ...builtin, id: "old", builtin: false }],
  );
  await page.waitForFunction(
    () => (window as unknown as { responses: unknown[] }).responses.length === 1,
  );
  await paired.worker.evaluate((templates) => chrome.storage.local.set({ templates }), [builtin]);
  await page.waitForFunction(
    () => (window as unknown as { responses: unknown[] }).responses.length === 2,
  );
  for (const index of [1, 0]) {
    await page.evaluate((i) => {
      const held = (
        window as unknown as {
          responses: { callback(response: unknown): void; response: unknown }[];
        }
      ).responses[i];
      if (!held) throw new Error("missing refresh");
      held.callback(held.response);
    }, index);
    await expect(picker.locator("option")).toHaveCount(1);
  }
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
    await expect(page.getByRole("button", { name: "Translate", exact: true })).toBeEnabled();
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
