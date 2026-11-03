import { browser } from "wxt/browser";
import { connectionItem } from "../settings/store";

export function registerOnboarding(): void {
  browser.runtime.onInstalled.addListener(async (details) => {
    if (details.reason !== "install") return;
    if (await connectionItem.getValue()) return;
    await browser.tabs.create({ url: browser.runtime.getURL("/onboarding.html") });
  });
}
