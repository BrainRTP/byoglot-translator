<script lang="ts">
  import { onMount } from "svelte";
  import { browser } from "wxt/browser";
  import { resolveLang } from "../../lib/i18n";
  import {
    type PageState,
    type Status,
    sendMessage,
    sendTabMessage,
    type TabView,
  } from "../../lib/messaging/protocol";
  import type { ModelInfo } from "../../lib/opencode/types";
  import { toTemplateSettings } from "../../lib/settings/effective";
  import type { EffectiveSettings, Template } from "../../lib/settings/types";
  import { changeUiLang, tr } from "../../lib/ui/i18n.svelte";
  import { languageOptions } from "../../lib/ui/languages";
  import ModelPicker from "../../lib/ui/ModelPicker.svelte";
  import {
    askPage,
    MAX_POLL_FAILURES,
    type PageResult,
    type PageTrack,
    pollIntervalMs,
    trackPage,
    withTimeout,
  } from "../../lib/ui/page-bridge";
  import {
    errorView,
    isTranslatableUrl,
    mainAction,
    modelWarning,
    pageFailure,
    pageHostname,
    progressView,
  } from "../../lib/ui/popup-logic";
  import Segmented from "../../lib/ui/Segmented.svelte";
  import StatusDot from "../../lib/ui/StatusDot.svelte";
  import { createSerialQueue } from "../../lib/ui/serial-queue";
  import { applyTheme, rememberLook } from "../../lib/ui/theme";

  const IDLE: PageState = { state: "idle", done: 0, total: 0, failed: 0 };
  const PROMPT_DEBOUNCE_MS = 250;
  const LOAD_TIMEOUT_MS = 10_000;

  let loaded = $state(false);
  let status = $state<Status | null>(null);
  let tab = $state<{ id: number; hostname: string; web: boolean } | null>(null);
  let view = $state<TabView | null>(null);
  let templates = $state<Template[]>([]);
  let models = $state<ModelInfo[]>([]);
  let page = $state<PageState>(IDLE);
  let pageAvailable = $state(true);
  let promptOpen = $state(false);
  let promptDraft = $state("");
  let confirmingUpdate = $state(false);
  let naming = $state(false);
  let newName = $state("");
  let picker: ModelPicker | undefined = $state();
  let nameInput: HTMLInputElement | undefined = $state();
  let promptTimer: ReturnType<typeof setTimeout> | undefined;
  let polling = false;
  let loadFailed = $state(false);
  let dismissed = $state(false);
  let server: TabView | null = null;
  let track: PageTrack = { state: IDLE, available: true, failures: 0 };
  const queue = createSerialQueue();

  // unknown status counts as usable: a broken connection shows up as a page error instead
  const usable = $derived(status?.state !== "disconnected");
  const pageFail = $derived(pageFailure(page, dismissed));
  const failure = $derived(
    status?.state === "error"
      ? errorView(status.kind, status.retryAfterMs, Date.now(), status.backend)
      : pageFail.error,
  );
  const showResume = $derived(status?.state !== "error" && pageFail.showResume);
  const progress = $derived(progressView(page));
  const action = $derived(mainAction(page));
  const warning = $derived(view ? modelWarning(view) : null);
  const mainDisabled = $derived(!usable || !tab?.web || !pageAvailable);
  const showSettings = $derived(status?.state !== "disconnected" && tab?.web === true && view);
  const ruleTemplate = $derived(
    view?.rule ? templates.find((t) => t.id === view?.rule?.templateId) : undefined,
  );
  const canPin = $derived(
    !!view && !!tab?.hostname && (!view.rule || view.rule.templateId !== view.template.id),
  );

  const templateName = (t: Template) => (t.builtin ? tr("template.builtin") : t.name);

  function setView(next: TabView, syncDraft: boolean) {
    view = next;
    if (syncDraft) promptDraft = next.settings.prePrompt;
  }

  function applyPage(result: PageResult, tolerance: number = MAX_POLL_FAILURES) {
    track = trackPage(track, result, tolerance);
    page = track.state;
    pageAvailable = track.available;
    if (page.state !== "error") dismissed = false;
  }

  const queryPage = (tabId: number) =>
    askPage(() => sendTabMessage("pageState", undefined, tabId));

  async function loadTab(current: { id: number; hostname: string }) {
    const [v, list, pr] = await Promise.all([
      sendMessage("tabView", { tabId: current.id, hostname: current.hostname }),
      sendMessage("templates", undefined),
      queryPage(current.id),
    ]);
    server = v;
    setView(v, true);
    templates = list;
    applyPage(pr, 1);
  }

  async function checkStatus(fresh: boolean) {
    const st = await sendMessage("status", fresh ? { fresh } : undefined);
    status = st;
    if (st.state !== "connected" || !tab?.web) return;
    models = await sendMessage("models", undefined);
    // the first view skipped the missing-model check while the list was loading
    if (view) await reloadView(false);
  }

  // renders from local data; the network check only updates the status when it returns
  async function loadAll(fresh: boolean) {
    const [g, [active], last] = await Promise.all([
      sendMessage("globals", undefined),
      browser.tabs.query({ active: true, currentWindow: true }),
      sendMessage("lastStatus", undefined),
    ]);
    changeUiLang(g.uiLang);
    applyTheme(document.documentElement, g.theme);
    rememberLook(g);
    document.documentElement.lang = resolveLang();
    tab = {
      id: active?.id ?? -1,
      hostname: pageHostname(active?.url),
      web: active?.id !== undefined && isTranslatableUrl(active.url),
    };
    status = last;
    const check = checkStatus(fresh).catch(() => {});
    if (last?.state !== "disconnected" && tab.web) await loadTab(tab);
    if (fresh) await check;
  }

  async function load(fresh = false) {
    loadFailed = false;
    try {
      await withTimeout(loadAll(fresh), LOAD_TIMEOUT_MS);
    } catch {
      loadFailed = true;
    } finally {
      loaded = true;
    }
  }

  onMount(() => {
    void load();
    return dropPrompt;
  });

  const pollState = $derived(page.state);

  $effect(() => {
    const ms = pollIntervalMs(pollState);
    if (ms === null || !tab) return;
    const tabId = tab.id;
    const id = setInterval(async () => {
      if (polling) return;
      polling = true;
      try {
        applyPage(await queryPage(tabId));
      } finally {
        polling = false;
      }
    }, ms);
    return () => clearInterval(id);
  });

  $effect(() => {
    if (naming) nameInput?.focus();
  });

  async function command(kind: "toggle" | "stop" | "restore") {
    if (!tab) return;
    const tabId = tab.id;
    applyPage(await askPage(() => sendTabMessage("pageCommand", kind, tabId)), 1);
  }

  function onMain() {
    void command(action === "translate" ? "toggle" : "restore");
  }

  function run(task: () => Promise<TabView>, syncDraft = false): Promise<void> {
    return queue
      .enqueue(
        async () => {
          const next = await task();
          server = next;
          return next;
        },
        (next) => setView(next, syncDraft),
      )
      .catch(() => reloadView());
  }

  function reloadView(syncDraft = true): Promise<void> {
    const current = tab;
    if (!current) return Promise.resolve();
    return queue
      .enqueue(
        async () => {
          const next = await sendMessage("tabView", { tabId: current.id, hostname: current.hostname });
          server = next;
          return next;
        },
        (next) => setView(next, syncDraft),
      )
      .catch(() => {});
  }

  function dropPrompt() {
    clearTimeout(promptTimer);
    promptTimer = undefined;
  }

  function saveSettings(patch: Partial<EffectiveSettings>) {
    if (!tab || !view) return;
    const tabId = tab.id;
    if (page.state === "error") dismissed = true;
    view = {
      ...view,
      settings: { ...view.settings, ...patch },
      ...(patch.pageModel !== undefined && { pageModel: { model: patch.pageModel, missing: false } }),
    };
    void run(() => {
      const base = (server as TabView).settings;
      return sendMessage("setTabSettings", { tabId, settings: { ...base, ...patch } });
    });
  }

  function onPromptInput(event: Event) {
    promptDraft = (event.currentTarget as HTMLTextAreaElement).value;
    dropPrompt();
    promptTimer = setTimeout(() => {
      promptTimer = undefined;
      saveSettings({ prePrompt: promptDraft });
    }, PROMPT_DEBOUNCE_MS);
  }

  function flushPrompt() {
    if (promptTimer === undefined) return;
    dropPrompt();
    saveSettings({ prePrompt: promptDraft });
  }

  function chooseTemplate(templateId: string) {
    if (!tab) return;
    const { id: tabId, hostname } = tab;
    dropPrompt();
    if (page.state === "error") dismissed = true;
    void run(() => sendMessage("applyTemplate", { tabId, hostname, templateId }), true);
  }

  function onTemplate(event: Event) {
    confirmingUpdate = false;
    naming = false;
    chooseTemplate((event.currentTarget as HTMLSelectElement).value);
  }

  function resetToTemplate() {
    if (view) chooseTemplate(view.template.id);
  }

  function updateTemplate() {
    if (!tab || !view) return;
    const { id: tabId, hostname } = tab;
    const templateId = view.template.id;
    flushPrompt();
    confirmingUpdate = false;
    void run(async () => {
      templates = await sendMessage("templateOp", {
        type: "update",
        id: templateId,
        patch: { settings: toTemplateSettings((server as TabView).settings) },
      });
      return sendMessage("tabView", { tabId, hostname });
    });
  }

  function saveAsNew() {
    const name = newName.trim();
    if (!tab || !view || !name) return;
    const { id: tabId, hostname } = tab;
    flushPrompt();
    naming = false;
    newName = "";
    void run(async () => {
      const known = new Set(templates.map((t) => t.id));
      const base = (server as TabView).settings;
      templates = await sendMessage("templateOp", {
        type: "create",
        name,
        settings: toTemplateSettings(base),
      });
      const created = templates.find((t) => !known.has(t.id));
      if (!created) return sendMessage("tabView", { tabId, hostname });
      return sendMessage("setTabSettings", {
        tabId,
        settings: { ...base, templateId: created.id },
      });
    });
  }

  function pinTemplate() {
    if (!tab || !view) return;
    const { id: tabId, hostname } = tab;
    const id = view.rule?.pattern === hostname ? view.rule.id : crypto.randomUUID();
    const templateId = view.template.id;
    void run(async () => {
      await sendMessage("ruleOp", { type: "upsert", rule: { id, pattern: hostname, templateId } });
      return sendMessage("tabView", { tabId, hostname });
    });
  }

  async function refresh() {
    loaded = false;
    track = { state: IDLE, available: true, failures: 0 };
    page = IDLE;
    pageAvailable = true;
    await load(true);
  }

  function onRetry() {
    if (status?.state === "error") void refresh();
    else void command("toggle");
  }

  function openOnboarding() {
    void browser.tabs.create({ url: browser.runtime.getURL("/onboarding.html") });
    window.close();
  }

  function openOptions() {
    void sendMessage("openOptions", undefined)
      .catch(() => {})
      .finally(() => window.close());
  }

  function focusPicker() {
    picker?.focus();
  }

  function reloadPage() {
    if (!tab) return;
    void browser.tabs.reload(tab.id);
    window.close();
  }

  function resume() {
    void command("toggle");
  }

  function onFailureAction() {
    if (failure?.action === "connect") openOnboarding();
    else if (failure?.action === "chooseModel") focusPicker();
    else onRetry();
  }

  const failureLabel = $derived(
    failure?.action === "connect"
      ? tr("popup.connectAgain")
      : failure?.action === "chooseModel"
        ? tr("popup.chooseModel")
        : tr("common.retry"),
  );
</script>

<svelte:window onpagehide={flushPrompt} />

{#if loaded && loadFailed}
  <main class="pop">
    <div class="bn er" role="alert">
      <div class="bt">{tr("popup.loadFailed.title")}</div>
      <div>{tr("popup.loadFailed")}</div>
      <div><button class="btn sm" type="button" onclick={refresh}>{tr("common.retry")}</button></div>
    </div>
  </main>
{:else if !loaded}
  <main class="pop" aria-busy="true">
    <span class="spin" role="status" aria-label={tr("popup.loading")}></span>
  </main>
{:else}
  <main class="pop">
    <div class="head">
      <div class="state">
        <StatusDot tone={status === null ? "wait" : status.state === "connected" ? "ok" : "er"} />
        <span class="strong">
          {status === null
            ? tr("status.checking")
            : status.state === "connected"
              ? tr("status.connected")
              : tr("status.disconnected")}
        </span>
        {#if status?.state === "connected"}
          <span class="mono muted">{status.kind === "provider" ? status.name : `opencode ${status.version}`}</span>
        {/if}
      </div>
      <button class="btn ico" type="button" aria-label={tr("common.settings")} onclick={openOptions}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="M4 7h10M18 7h2M4 17h2M10 17h10"></path>
          <circle cx="16" cy="7" r="2"></circle>
          <circle cx="8" cy="17" r="2"></circle>
        </svg>
      </button>
    </div>

    {#if status?.state === "disconnected"}
      <button class="btn pri big" type="button" onclick={openOnboarding}>
        {tr("popup.connect")}
      </button>
    {:else}
      {#if failure}
        <div class="bn {failure.tone}" role="alert">
          <div class="bt">{failure.title}</div>
          <div>{failure.body}</div>
          {#if failure.hint}
            <div class="mono cmd">{failure.hint}</div>
          {/if}
          <div class="actions">
            <button class="btn sm" type="button" onclick={onFailureAction}>{failureLabel}</button>
            {#if showResume}
              <button class="btn sm" type="button" onclick={resume}>{tr("common.retry")}</button>
            {/if}
          </div>
        </div>
      {:else if showResume}
        <div><button class="btn sm" type="button" onclick={resume}>{tr("common.retry")}</button></div>
      {/if}

      <div class="main">
        <button class="btn pri big" type="button" disabled={mainDisabled} onclick={onMain}>
          {action === "translate" ? tr("popup.translatePage") : tr("popup.showOriginal")}
        </button>
        {#if tab && !tab.web}
          <div class="muted small">{tr("popup.unsupportedPage")}</div>
        {:else if usable && !pageAvailable}
          <div class="muted small">{tr("popup.noReceiver")}</div>
          <div><button class="btn sm" type="button" onclick={reloadPage}>{tr("popup.reloadPage")}</button></div>
        {/if}
      </div>

      {#if progress}
        <div class="progress">
          <div class="prow">
            <span>
              {progress.paused
                ? tr("popup.paused", { done: page.done, total: page.total })
                : tr("popup.progress", { done: page.done, total: page.total })}
            </span>
            {#if progress.stoppable}
              <button class="btn sm" type="button" onclick={() => command("stop")}>{tr("popup.stop")}</button>
            {/if}
          </div>
          <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax={page.total} aria-valuenow={page.done} aria-label={tr("popup.progressLabel")}>
            <i style="width: {progress.percent}%"></i>
          </div>
        </div>
      {/if}

      {#if showSettings && view && tab}
        <div class="grp">
          <div>
            <div class="lbl">{tr("popup.template")}</div>
            <div class="trow">
              <select class="sel" aria-label={tr("popup.template")} value={view.template.id} onchange={onTemplate}>
                {#each templates as t (t.id)}
                  <option value={t.id}>{templateName(t)}</option>
                {/each}
              </select>
              {#if view.modified}
                <span class="chip">{tr("popup.modified")}</span>
              {/if}
            </div>
          </div>

          {#if view.modified && !confirmingUpdate && !naming}
            <div class="actions">
              <button class="btn sm" type="button" onclick={() => (confirmingUpdate = true)}>{tr("popup.updateTemplate")}</button>
              <button class="btn sm" type="button" onclick={() => (naming = true)}>{tr("popup.saveAsNew")}</button>
              <button class="lnk" type="button" onclick={resetToTemplate}>{tr("popup.resetToTemplate")}</button>
            </div>
          {/if}

          {#if confirmingUpdate}
            <div class="panel" role="alertdialog">
              <div>{tr("popup.confirmUpdate", { name: templateName(view.template) })}</div>
              <div class="actions">
                <button class="btn sm pri" type="button" onclick={updateTemplate}>{tr("popup.update")}</button>
                <button class="btn sm" type="button" onclick={() => (confirmingUpdate = false)}>{tr("common.cancel")}</button>
              </div>
            </div>
          {/if}

          {#if naming}
            <form class="panel" onsubmit={(e) => { e.preventDefault(); void saveAsNew(); }}>
              <input class="sel" aria-label={tr("popup.newTemplateName")} placeholder={tr("popup.newTemplateName")} bind:value={newName} bind:this={nameInput} />
              <div class="actions">
                <button class="btn sm pri" type="submit" disabled={!newName.trim()}>{tr("popup.save")}</button>
                <button class="btn sm" type="button" onclick={() => (naming = false)}>{tr("common.cancel")}</button>
              </div>
            </form>
          {/if}

          <div>
            <button class="lnk toggle" type="button" aria-expanded={promptOpen} onclick={() => (promptOpen = !promptOpen)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d={promptOpen ? "M6 15l6-6 6 6" : "M9 6l6 6-6 6"}></path>
              </svg>
              <span class="under">{tr("popup.prePrompt")}</span>
            </button>
            {#if promptOpen}
              <div class="prompt">
                <textarea class="sel area" rows="5" aria-label={tr("popup.prePrompt")} value={promptDraft} oninput={onPromptInput} onblur={flushPrompt}></textarea>
                <div class="muted small">{tr("popup.prePromptHint")}</div>
              </div>
            {/if}
          </div>

          <div class="divider"></div>

          <div class="site">
            <div class="srow">
              <span class="muted">{tr("popup.forThisSite")}</span>
              <span class="strong">
                {view.rule ? (ruleTemplate ? templateName(ruleTemplate) : view.rule.templateId) : tr("popup.noRule")}
              </span>
            </div>
            <div class="mono muted">{view.rule ? view.rule.pattern : tab.hostname}</div>
            {#if canPin}
              <div class="pin"><button class="lnk" type="button" onclick={pinTemplate}>{tr("popup.pinTemplate")}</button></div>
            {/if}
          </div>
        </div>

        <div>
          <ModelPicker bind:this={picker} {models} value={view.pageModel.model} onchange={(m) => saveSettings({ pageModel: m })} />
          {#if warning}
            <div class="bn wn compact" role="status">
              <div>{warning}</div>
              <div><button class="lnk" type="button" onclick={focusPicker}>{tr("popup.changeModel")}</button></div>
            </div>
          {/if}
        </div>

        <div class="modes">
          <div class="cell">
            <div class="lbl">{tr("popup.mode")}</div>
            <Segmented
              label={tr("popup.mode")}
              value={view.settings.displayMode}
              options={[
                { value: "replace", label: tr("popup.modeReplace") },
                { value: "bilingual", label: tr("popup.modeBilingual") },
              ]}
              onchange={(displayMode) => saveSettings({ displayMode })}
            />
          </div>
          <div class="cell">
            <div class="lbl">{tr("popup.targetLang")}</div>
            <select class="sel" aria-label={tr("popup.targetLang")} value={view.settings.targetLang} onchange={(e) => saveSettings({ targetLang: e.currentTarget.value })}>
              {#each languageOptions(view.settings.targetLang) as l (l.code)}
                <option value={l.code}>{l.name}</option>
              {/each}
            </select>
          </div>
        </div>
      {/if}
    {/if}
  </main>
{/if}

<style>
  .pop {
    --side-col: 104px;
    width: 360px;
    padding: 12px 16px 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 32px;
  }
  .state {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex-wrap: wrap;
  }
  .strong {
    font-weight: 600;
  }
  .muted {
    color: var(--mu);
  }
  .small {
    font-size: 12px;
  }
  .btn.ico {
    width: 32px;
    height: 32px;
    padding: 0;
    border-color: transparent;
    background: none;
  }
  .btn.big {
    height: 44px;
    width: 100%;
    font-size: 14px;
  }
  .main {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .bn {
    border: 1px solid;
    border-radius: 6px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .bt {
    font-weight: 600;
  }
  .bn.er {
    background: var(--ers);
    border-color: var(--er);
  }
  .bn.er .bt {
    color: var(--er);
  }
  .bn.wn {
    background: var(--wns);
    border-color: var(--wn);
  }
  .bn.wn .bt {
    color: var(--wn);
  }
  .bn.compact {
    margin-top: 8px;
    padding: 8px 10px;
    gap: 6px;
  }
  .cmd {
    background: var(--bg);
    border: 1px solid var(--bd);
    border-radius: 4px;
    padding: 6px 10px;
    color: var(--tx);
  }
  .progress {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .prow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 28px;
  }
  .bar {
    height: 4px;
    border-radius: 2px;
    background: var(--bd);
  }
  .bar i {
    display: block;
    height: 4px;
    border-radius: 2px;
    background: var(--ac);
  }
  .grp {
    border: 1px solid var(--bd);
    border-radius: 8px;
    background: var(--sf);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .trow {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .chip {
    font-size: 11px;
    line-height: 16px;
    border: 1px solid var(--bd2);
    border-radius: 10px;
    padding: 1px 8px;
    color: var(--tx);
    white-space: nowrap;
    flex: none;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .panel {
    background: var(--bg);
    border: 1px solid var(--bd2);
    border-radius: 6px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    text-decoration: none;
  }
  .under {
    text-decoration: underline;
  }
  .prompt {
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .area {
    height: auto;
    padding: 8px;
    line-height: 1.45;
    resize: vertical;
    display: block;
  }
  .divider {
    height: 1px;
    background: var(--bd);
  }
  .site {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .srow {
    display: flex;
    flex-wrap: wrap;
    gap: 0 6px;
  }
  .pin {
    margin-top: 2px;
  }
  .modes {
    display: grid;
    grid-template-columns: minmax(0, 1fr) var(--side-col);
    gap: 8px;
    align-items: end;
  }
  .cell {
    min-width: 0;
  }
</style>
