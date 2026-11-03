import { browser } from "wxt/browser";
import { PAGE_PORT_NAME } from "../messaging/page-port";
import { onMessage, type ProtocolMap } from "../messaging/protocol";
import type { createTranslationService } from "../translate/service";
import { registerCommands } from "./commands";
import { createHandlers, type HandlerDeps, type Sender } from "./handlers";
import { registerOnboarding } from "./onboarding";
import { attachPagePort } from "./page-jobs";

export type BackgroundDeps = Omit<HandlerDeps, "service"> & {
  service: ReturnType<typeof createTranslationService>;
};

const CONTENT_ALLOWED: ReadonlySet<keyof ProtocolMap> = new Set([
  "tabView",
  "translateSelection",
  "cancelSelection",
  "pageBadge",
  "templates",
  "openOptions",
]);

function isOwnSender(sender: { id?: string } | undefined): boolean {
  return sender?.id === browser.runtime.id;
}

function isExtensionPage(sender: { url?: string }): boolean {
  return sender.url?.startsWith(browser.runtime.getURL("")) === true;
}

function assertAllowed(type: keyof ProtocolMap, sender: Sender & { url?: string }): void {
  if (!isOwnSender(sender)) throw new Error("Rejected sender");
  if (isExtensionPage(sender)) return;
  if (sender.tab && CONTENT_ALLOWED.has(type)) return;
  throw new Error(`Message not allowed from this sender: ${type}`);
}

export function registerBackground(deps: BackgroundDeps): void {
  const handlers = createHandlers(deps);

  const handle = <K extends keyof ProtocolMap>(
    type: K,
    fn: (
      data: Parameters<ProtocolMap[K]>[0],
      sender: Sender,
    ) => ReturnType<ProtocolMap[K]> | Promise<ReturnType<ProtocolMap[K]>>,
  ) => {
    onMessage(type, (message) => {
      assertAllowed(type, message.sender);
      return fn(message.data as Parameters<ProtocolMap[K]>[0], message.sender);
    });
  };

  handle("status", () => handlers.status());
  handle("pair", (link) => handlers.pair(link));
  handle("connectManual", (conn) => handlers.connectManual(conn));
  handle("disconnect", () => handlers.disconnect());
  handle("models", () => handlers.models());
  handle("tabView", (i, sender) => handlers.tabView(i, sender));
  handle("setTabSettings", (i) => handlers.setTabSettings(i));
  handle("applyTemplate", (i) => handlers.applyTemplate(i));
  handle("globals", () => handlers.globals());
  handle("setGlobals", (g) => handlers.setGlobals(g));
  handle("templates", () => handlers.templates());
  handle("templateOp", (op) => handlers.templateOp(op));
  handle("rules", () => handlers.rules());
  handle("ruleOp", (op) => handlers.ruleOp(op));
  handle("languageProfiles", () => handlers.languageProfiles());
  handle("languageProfileOp", (op) => handlers.languageProfileOp(op));
  handle("translateSelection", (i, sender) => handlers.translateSelection(i, sender));
  handle("cancelSelection", (requestId, sender) => handlers.cancelSelection(requestId, sender));
  handle("pageBadge", (state, sender) => handlers.pageBadge(state, sender));
  handle("cacheStats", () => handlers.cacheStats());
  handle("cacheClear", () => handlers.cacheClear());
  handle("openOptions", () => browser.runtime.openOptionsPage());

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== PAGE_PORT_NAME) return;
    if (!isOwnSender(port.sender)) {
      port.disconnect();
      return;
    }
    attachPagePort(port, handlers, deps.service);
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    void handlers.tabRemoved(tabId);
  });
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url) void handlers.tabNavigated(tabId, changeInfo.url);
  });

  registerCommands();
  registerOnboarding();
}
