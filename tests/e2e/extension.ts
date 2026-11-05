import path from "node:path";
import { type BrowserContext, chromium, type Page, type Worker } from "@playwright/test";

export const EXTENSION_DIR = path.join(import.meta.dirname, "../../dist/chrome-mv3");

export type Extension = { context: BrowserContext; worker: Worker; id: string };

export async function launchExtension(): Promise<Extension> {
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    locale: "en-US",
    args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  return { context, worker, id: new URL(worker.url()).host };
}

export type Seed = {
  url: string;
  token: string;
  pageModel?: { providerID: string; id: string; variant?: string };
};

const FLASH = { providerID: "deepseek", id: "deepseek-flash", variant: "none" };

export async function seedConnection(worker: Worker, seed: Seed): Promise<void> {
  const id = "e2e-opencode";
  const model = { ...(seed.pageModel ?? FLASH), connectionId: id };
  await worker.evaluate(
    (s) =>
      chrome.storage.local.set({
        connections: [
          {
            id: s.id,
            kind: "opencode",
            url: s.url,
            username: "opencode",
            password: s.token,
            pageModel: s.model,
            selectionModel: s.model,
          },
        ],
        activeConnectionId: s.id,
        globals: {
          sourceLang: "auto",
          targetLang: "ru",
          displayMode: "replace",
          defaultTemplateId: "builtin-default",
          uiLang: "en",
        },
      }),
    { id, url: seed.url, token: seed.token, model },
  );
}

/** The storage layout of 0.2.7 and earlier, which the extension migrates on first read. */
export async function seedLegacyConnection(worker: Worker, seed: Seed): Promise<void> {
  const model = seed.pageModel ?? FLASH;
  await worker.evaluate(
    (s) =>
      chrome.storage.local.set({
        connection: { url: s.url, username: "opencode", password: s.token },
        globals: {
          sourceLang: "auto",
          targetLang: "ru",
          displayMode: "replace",
          pageModel: s.model,
          selectionModel: s.model,
          defaultTemplateId: "builtin-default",
          uiLang: "en",
        },
      }),
    { url: seed.url, token: seed.token, model },
  );
}

/** Tab urls are hidden from the extension on sites outside host_permissions, so the active tab is used. */
export async function tabIdFor(worker: Worker, page: Page): Promise<number> {
  await page.bringToFront();
  return worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id === undefined) throw new Error("no active tab");
    return tab.id;
  });
}

/** The popup is opened as a regular tab, so tabs.query is pointed at the page under test. */
export async function openPopup(ext: Extension, target: Page, init?: () => void): Promise<Page> {
  const tabId = await tabIdFor(ext.worker, target);
  const url = target.url();
  const popup = await ext.context.newPage();
  await popup.setViewportSize({ width: 360, height: 700 });
  await popup.addInitScript(
    ({ id, u }) => {
      chrome.tabs.query = async () => [{ id, url: u }];
    },
    { id: tabId, u: url },
  );
  if (init) await popup.addInitScript(init);
  await popup.goto(`chrome-extension://${ext.id}/popup.html`);
  return popup;
}

export async function seedProvider(worker: Worker, seed: { url: string; key: string }) {
  await worker.evaluate(
    (s) => {
      const id = "e2e-provider";
      const model = {
        connectionId: id,
        providerID: "custom",
        id: "deepseek-flash",
        variant: "none",
      };
      return chrome.storage.local.set({
        connections: [
          {
            id,
            kind: "provider",
            name: "Custom",
            preset: "custom",
            baseUrl: s.url,
            apiKey: s.key,
            pageModel: model,
            selectionModel: model,
          },
        ],
        activeConnectionId: id,
        globals: {
          sourceLang: "auto",
          targetLang: "ru",
          displayMode: "replace",
          defaultTemplateId: "builtin-default",
          uiLang: "en",
        },
      });
    },
    { url: seed.url, key: seed.key },
  );
}
