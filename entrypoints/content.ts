import { browser } from "wxt/browser";
import { createPageTranslator, shareInFlight } from "../lib/dom/page-translator";
import { createProgressBar } from "../lib/dom/progress-bar";
import { setUiLang } from "../lib/i18n";
import { PAGE_PORT_NAME } from "../lib/messaging/page-port";
import { onTabMessage, sendMessage } from "../lib/messaging/protocol";
import { createSelectionInserter } from "../lib/selection/insert";
import { mountSelectionUi } from "../lib/selection/trigger";

export default defineContentScript({
  matches: ["<all_urls>"],
  allFrames: true,
  runAt: "document_idle",
  main() {
    // background resolves tab and hostname from the sender
    const loadView = shareInFlight(() => sendMessage("tabView", { tabId: -1 }));

    const isTop = window === window.top;
    const bar = createProgressBar(document);
    let barOn = false;
    let lastState = "idle";

    const translator = createPageTranslator({
      doc: document,
      connect: () => browser.runtime.connect({ name: PAGE_PORT_NAME }),
      getDisplayMode: async () => (await loadView()).settings.displayMode,
      getAnimation: async () => (await loadView()).animation,
      targetLang: async () => (await loadView()).settings.targetLang,
      detectLanguage: async (text) => {
        const result = await browser.i18n.detectLanguage(text);
        return { lang: result.languages[0]?.language ?? "und", reliable: result.isReliable };
      },
      onState: (state) => {
        if (!isTop) return;
        void sendMessage("pageBadge", state.state).catch(() => {});
        const entering = state.state === "translating" && lastState !== "translating";
        lastState = state.state;
        if (state.state === "idle") bar.update(state);
        else if (entering) {
          void loadView()
            .then((v) => {
              barOn = v.progressBar;
              if (barOn) bar.update(state);
            })
            .catch(() => {});
        } else if (barOn) bar.update(state);
      },
    });

    // child frames must not answer: the first response wins, so a never-settling promise
    // keeps them from shadowing the top frame
    const silent = () => new Promise<never>(() => {});

    const inserter = createSelectionInserter({
      doc: document,
      connect: () => browser.runtime.connect({ name: PAGE_PORT_NAME }),
      getDisplayMode: async () => (await loadView()).settings.displayMode,
      theme: async () => (await loadView()).theme,
    });

    onTabMessage("pageCommand", ({ data }) => {
      const { state } = translator.state();
      if (data === "stop") translator.stop();
      else if (data === "restore") translator.restore();
      else if (state === "idle" || state === "error") {
        // two journals must never write the same text nodes
        inserter.restoreAll();
        void translator.start();
      } else translator.restore();
      return isTop ? translator.state() : silent();
    });
    if (isTop) onTabMessage("pageState", () => translator.state());

    // content scripts cannot read globals, so the UI language follows the browser
    setUiLang("auto");
    const activeRequests = new Set<string>();
    const cancelAll = () => {
      const ids = [...activeRequests];
      activeRequests.clear();
      for (const id of ids) void sendMessage("cancelSelection", id).catch(() => {});
    };
    const selectionUi = mountSelectionUi(document, {
      translate: (text, context, templateId, window) => {
        const requestId = crypto.randomUUID();
        activeRequests.add(requestId);
        return sendMessage("translateSelection", {
          text,
          context,
          hostname: location.hostname,
          requestId,
          window,
          ...(templateId !== undefined && { templateId }),
        }).finally(() => activeRequests.delete(requestId));
      },
      cancel: cancelAll,
      listTemplates: () => sendMessage("templates", undefined),
      openSettings: () => void sendMessage("openOptions", undefined).catch(() => {}),
      currentTemplateId: async () => (await loadView()).settings.templateId,
      theme: async () => (await loadView()).theme,
      insert: inserter.insert,
      canInsert: () => translator.state().state === "idle",
    });

    // every frame registers; only the one holding a selection answers
    onTabMessage("selectionCommand", () => {
      if (!selectionUi.hasSelection()) return silent();
      selectionUi.trigger();
    });
    onTabMessage("selectionInsertCommand", () => {
      if (!selectionUi.hasSelection()) return silent();
      selectionUi.insert();
    });
  },
});
