import { browser } from "wxt/browser";
import { opencodeConnection } from "./opencode-connection";

export function registerOnboarding(): void {
  browser.runtime.onInstalled.addListener(async (details) => {
    if (details.reason !== "install") return;
    if (await opencodeConnection.getValue()) return;
    await browser.tabs.create({ url: browser.runtime.getURL("/onboarding.html") });
  });
}
