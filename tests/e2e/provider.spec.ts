import type { Page } from "@playwright/test";
import { type Extension, openPopup, seedProvider } from "./extension";
import { expect, test } from "./fixtures";
import { type MockProvider, type ProviderMode, startMockProvider } from "./mock-provider";
import { queryClosedShadow } from "./shadow";

async function connectProvider(page: Page, extId: string, provider: MockProvider) {
  await page.goto(`chrome-extension://${extId}/onboarding.html`);
  await page.getByRole("button", { name: "My provider" }).click();
  await page.getByRole("combobox").selectOption("custom");
  await page.getByLabel("Base URL").fill(provider.url);
  await page.getByLabel("API key").fill(provider.key);
  await page.getByRole("button", { name: "Save" }).click();
}

async function translateToRussian(ext: Extension) {
  await ext.worker.evaluate(async () => {
    const { globals } = await chrome.storage.local.get("globals");
    await chrome.storage.local.set({ globals: { ...(globals as object), targetLang: "ru" } });
  });
}

async function withProvider(mode: ProviderMode, run: (provider: MockProvider) => Promise<void>) {
  const provider = await startMockProvider({ mode });
  try {
    await run(provider);
  } finally {
    await provider.stop();
  }
}

const completions = (provider: MockProvider) =>
  provider.requests.filter((r) => r.path === "/v1/chat/completions");

test("translates a page and a selection through a provider and switches back from opencode", async ({
  ext,
  mock,
}) => {
  await withProvider("ok", async (provider) => {
    const onboarding = await ext.context.newPage();
    await connectProvider(onboarding, ext.id, provider);
    await expect(onboarding.getByText("Connected", { exact: true })).toBeVisible();
    await translateToRussian(ext);

    const page = await ext.context.newPage();
    await page.goto(`${mock.url}/fixtures/article.html`);
    const popup = await openPopup(ext, page);
    await popup.getByRole("button", { name: "Translate page" }).click();
    await expect(page.locator("#intro")).toContainText("[ru] ", { timeout: 15_000 });

    await page.locator("#sel").click({ clickCount: 3 });
    const selected = (await page.evaluate(() => getSelection()?.toString() ?? "")).trim();
    await expect.poll(() => queryClosedShadow(page, "button.icon")).not.toBeNull();
    const hit = await queryClosedShadow(page, "button.icon");
    if (!hit) throw new Error("icon disappeared");
    await page.mouse.click(hit.center.x, hit.center.y);
    await expect
      .poll(async () => (await queryClosedShadow(page, ".card .scroll"))?.text.trim())
      .toBe(`[ru] ${selected}`);

    const calls = completions(provider);
    expect(calls.length).toBeGreaterThan(1);
    for (const call of calls) {
      expect(call.authorization).toBe(`Bearer ${provider.key}`);
      expect(call.body).not.toHaveProperty("reasoning_effort");
    }
    expect(mock.requests.filter((r) => r.path === "/api/experimental/generate/text")).toHaveLength(
      0,
    );

    const link = `${mock.url}/auth/connect/${mock.pairCode}`;
    await onboarding.goto(`chrome-extension://${ext.id}/onboarding.html`);
    await onboarding.getByLabel("Connection link").fill(link);
    await onboarding.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(onboarding.getByText("opencode 2.2.5")).toBeVisible();

    const options = await ext.context.newPage();
    await options.goto(`chrome-extension://${ext.id}/options.html`);
    const providerRow = options.locator("li[data-connection]", { hasText: "Custom" });
    const opencodeRow = options.locator("li[data-connection]", { hasText: "opencode" });
    await expect(opencodeRow.getByText("Active", { exact: true })).toBeVisible();
    await providerRow.getByRole("button", { name: "Use" }).click();
    await expect(providerRow.getByText("Active", { exact: true })).toBeVisible();

    const popup2 = await openPopup(ext, page);
    await expect(popup2.locator("body")).toContainText("DeepSeek-V4.1-Flash");
    const stored = await ext.worker.evaluate(async () => {
      const { connections } = await chrome.storage.local.get("connections");
      return connections as { kind: string; pageModel?: { id: string } }[];
    });
    expect(stored.find((c) => c.kind === "provider")?.pageModel?.id).toBe("deepseek-flash");
  });
});

test("a rejected provider key is reported without mentioning opencode", async ({ ext, mock }) => {
  await withProvider("bad_key", async (provider) => {
    await seedProvider(ext.worker, provider);
    const page = await ext.context.newPage();
    await page.goto(`${mock.url}/fixtures/article.html`);
    const popup = await openPopup(ext, page);
    await expect(popup.getByRole("alert")).toContainText("The provider rejected the key");
    await expect(popup.locator("body")).not.toContainText(/opencode/i);
  });
});
