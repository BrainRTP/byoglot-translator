import { browser } from "wxt/browser";
import { sendTabMessage } from "../messaging/protocol";

export const SELECTION_MENU_ID = "oct-translate-selection";

export function registerCommands(): void {
  browser.commands.onCommand.addListener(async (command) => {
    if (command !== "translate-page" && command !== "translate-selection") return;
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id === undefined) return;
      if (command === "translate-page") await sendTabMessage("pageCommand", "toggle", tab.id);
      else await sendTabMessage("selectionCommand", undefined, tab.id);
    } catch {}
  });

  browser.runtime.onInstalled.addListener(async () => {
    await browser.contextMenus.removeAll();
    browser.contextMenus.create({
      id: SELECTION_MENU_ID,
      title: browser.i18n.getMessage("contextTranslateSelection"),
      contexts: ["selection"],
    });
  });

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== SELECTION_MENU_ID || tab?.id === undefined) return;
    try {
      await sendTabMessage("selectionCommand", undefined, {
        tabId: tab.id,
        ...(info.frameId !== undefined && { frameId: info.frameId }),
      });
    } catch {}
  });
}
