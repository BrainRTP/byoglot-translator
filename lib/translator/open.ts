import { browser } from "wxt/browser";
import { isAndroid } from "../ui/platform";

export async function openTranslator(): Promise<void> {
  const url = browser.runtime.getURL("/translator.html");
  const tabs = await browser.tabs.query({ url });
  const existing = tabs.find((tab) => tab.id !== undefined);
  if (existing?.id !== undefined) {
    await browser.tabs.update(existing.id, { active: true });
    if (existing.windowId !== undefined && !(await isAndroid())) {
      await browser.windows.update(existing.windowId, { focused: true });
    }
  } else {
    await browser.tabs.create({ url });
  }
}
