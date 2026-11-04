import { browser } from "wxt/browser";
import { connectionsStore } from "../settings/store";

export function registerOnboarding(): void {
  browser.runtime.onInstalled.addListener(async (details) => {
    if (details.reason !== "install") return;
    if ((await connectionsStore.getAll()).length > 0) return;
    await browser.tabs.create({ url: browser.runtime.getURL("/onboarding.html") });
  });
}
