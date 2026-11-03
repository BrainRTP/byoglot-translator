<script lang="ts">
  import { onMount } from "svelte";
  import { browser } from "wxt/browser";
  import { resolveLang, type UiLang } from "../../lib/i18n";
  import {
    type RuleOp,
    type Status,
    sendMessage,
    type TemplateOp,
  } from "../../lib/messaging/protocol";
  import type { ModelInfo, ModelRef } from "../../lib/opencode/types";
  import type { GlobalSettings, SiteRule, Template } from "../../lib/settings/types";
  import { changeUiLang, tr } from "../../lib/ui/i18n.svelte";
  import { languageOptions } from "../../lib/ui/languages";
  import ModelSelect from "../../lib/ui/ModelSelect.svelte";
  import { isFirefoxAgent, type ModelId } from "../../lib/ui/options-logic";
  import { errorView, variantFor } from "../../lib/ui/popup-logic";
  import Segmented from "../../lib/ui/Segmented.svelte";
  import SiteRules from "../../lib/ui/SiteRules.svelte";
  import StatusDot from "../../lib/ui/StatusDot.svelte";
  import { createSerialQueue } from "../../lib/ui/serial-queue";
  import TemplateEditor from "../../lib/ui/TemplateEditor.svelte";

  type Section = "connection" | "language" | "models" | "templates" | "rules" | "cache";
  type Flag = "saved" | "failed" | null;
  type Shortcut = { name: string; description: string; shortcut: string };

  const FLAG_MS = 2500;
  const SECTIONS = ["connection", "language", "models", "templates", "rules", "cache", "hotkeys"] as const;
  const NAV_KEYS = {
    connection: "opt.nav.connection",
    language: "opt.nav.language",
    models: "opt.nav.models",
    templates: "opt.nav.templates",
    rules: "opt.nav.rules",
    cache: "opt.nav.cache",
    hotkeys: "opt.nav.hotkeys",
  } as const;

  let loaded = $state(false);
  let loadFailed = $state(false);
  let status = $state<Status | null>(null);
  let globals = $state<GlobalSettings | null>(null);
  let templates = $state<Template[]>([]);
  let rules = $state<SiteRule[]>([]);
  let models = $state<ModelInfo[]>([]);
  let cacheEntries = $state(0);
  let shortcuts = $state<Shortcut[]>([]);
  let flags = $state<Record<Section, Flag>>({
    connection: null,
    language: null,
    models: null,
    templates: null,
    rules: null,
    cache: null,
  });
  let active = $state<string>("connection");

  const timers: Partial<Record<Section, ReturnType<typeof setTimeout>>> = {};
  const globalsQueue = createSerialQueue();
  const templatesQueue = createSerialQueue();
  const rulesQueue = createSerialQueue();
  const firefox = isFirefoxAgent(navigator.userAgent);

  const connected = $derived(status?.state === "connected");
  const failure = $derived(status?.state === "error" ? errorView(status.kind, status.retryAfterMs) : null);
  const uiOptions = $derived<{ value: UiLang; label: string }[]>([
    { value: "auto", label: tr("selection.auto") },
    { value: "ru", label: "Русский" },
    { value: "en", label: "English" },
  ]);

  function mark(section: Section, ok: boolean) {
    clearTimeout(timers[section]);
    flags[section] = ok ? "saved" : "failed";
    timers[section] = setTimeout(() => (flags[section] = null), FLAG_MS);
  }

  function applyLang(lang: UiLang) {
    changeUiLang(lang);
    document.documentElement.lang = resolveLang();
    document.title = `${tr("opt.title")} - ${tr("app.name")}`;
  }

  function commandLabel(name: string, description: string | undefined): string {
    if (name === "translate-page") return tr("opt.hotkeys.translatePage");
    if (name === "translate-selection") return tr("opt.hotkeys.translateSelection");
    return description || name;
  }

  async function loadShortcuts() {
    try {
      const all = await browser.commands.getAll();
      shortcuts = all
        .filter((c) => c.name && !c.name.startsWith("_"))
        .map((c) => ({
          name: c.name ?? "",
          description: c.description ?? "",
          shortcut: c.shortcut ?? "",
        }));
    } catch {
      shortcuts = [];
    }
  }

  async function loadModels(): Promise<ModelInfo[]> {
    return sendMessage("models", undefined).catch(() => []);
  }

  async function load() {
    loadFailed = false;
    try {
      const [g, tpl, rl, st, cache] = await Promise.all([
        sendMessage("globals", undefined),
        sendMessage("templates", undefined),
        sendMessage("rules", undefined),
        sendMessage("status", undefined),
        sendMessage("cacheStats", undefined),
      ]);
      globals = g;
      templates = tpl;
      rules = rl;
      status = st;
      cacheEntries = cache.entries;
      applyLang(g.uiLang);
      void loadShortcuts();
      models = st.state === "connected" ? await loadModels() : [];
    } catch {
      loadFailed = true;
    } finally {
      loaded = true;
    }
  }

  onMount(() => {
    void load();
  });

  $effect(() => {
    if (!loaded || loadFailed) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const hit = entries.find((e) => e.isIntersecting);
        if (hit) active = hit.target.id;
      },
      { rootMargin: "-10% 0px -75% 0px" },
    );
    for (const id of SECTIONS) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  });

  function patchGlobals(section: Section, patch: Partial<GlobalSettings>): Promise<boolean> {
    if (!globals) return Promise.resolve(false);
    globals = { ...globals, ...patch };
    return globalsQueue
      .enqueue(
        async () => {
          const current = await sendMessage("globals", undefined);
          await sendMessage("setGlobals", { ...current, ...patch });
        },
        () => {},
      )
      .then(() => {
        mark(section, true);
        return true;
      })
      .catch(async () => {
        mark(section, false);
        globals = await sendMessage("globals", undefined).catch(() => globals);
        return false;
      });
  }

  async function pickUiLang(lang: UiLang) {
    const previous = globals?.uiLang;
    applyLang(lang);
    const ok = await patchGlobals("language", { uiLang: lang });
    if (!ok && previous && globals) {
      globals = { ...globals, uiLang: previous };
      applyLang(previous);
    }
  }

  function setModel(kind: "pageModel" | "selectionModel", chosen: ModelId | null) {
    if (!globals || !chosen) return;
    const info = models.find((m) => m.providerID === chosen.providerID && m.id === chosen.id);
    const variant = info ? variantFor(info, globals[kind]?.variant) : undefined;
    patchGlobals("models", {
      [kind]: { ...chosen, ...(variant !== undefined && { variant }) } satisfies ModelRef,
    });
  }

  function setVariant(kind: "pageModel" | "selectionModel", variant: string) {
    const current = globals?.[kind];
    if (!current) return;
    patchGlobals("models", { [kind]: { ...current, variant } });
  }

  async function templateOp(op: TemplateOp): Promise<Template[] | null> {
    let result: Template[] | null = null;
    try {
      await templatesQueue.enqueue(
        async () => {
          result = await sendMessage("templateOp", op);
          return result;
        },
        (list) => (templates = list),
      );
    } catch {
      mark("templates", false);
      templates = await sendMessage("templates", undefined).catch(() => templates);
      return null;
    }
    mark("templates", true);
    if (op.type === "delete") {
      await Promise.all([
        sendMessage("rules", undefined).then((list) => (rules = list)),
        globalsQueue.enqueue(
          () => sendMessage("globals", undefined),
          (g) => (globals = g),
        ),
      ]).catch(() => {});
    }
    return result;
  }

  async function ruleOp(op: RuleOp): Promise<boolean> {
    try {
      await rulesQueue.enqueue(
        () => sendMessage("ruleOp", op),
        (list) => (rules = list),
      );
      mark("rules", true);
      return true;
    } catch {
      mark("rules", false);
      rules = await sendMessage("rules", undefined).catch(() => rules);
      return false;
    }
  }

  function openOnboarding() {
    void browser.tabs.create({ url: browser.runtime.getURL("/onboarding.html") });
  }

  async function disconnect() {
    if (!confirm(tr("opt.connection.confirmDisconnect"))) return;
    try {
      await sendMessage("disconnect", undefined);
      status = { state: "disconnected" };
      models = [];
      mark("connection", true);
    } catch {
      mark("connection", false);
    }
  }

  async function clearCache() {
    if (!confirm(tr("opt.cache.confirmClear"))) return;
    try {
      await sendMessage("cacheClear", undefined);
      cacheEntries = (await sendMessage("cacheStats", undefined)).entries;
      mark("cache", true);
    } catch {
      mark("cache", false);
    }
  }

  function openShortcuts() {
    void browser.tabs.create({ url: "chrome://extensions/shortcuts" });
  }

  const flagText = (f: Flag) =>
    f === "saved" ? tr("opt.saved") : f === "failed" ? tr("opt.saveFailed") : "";
</script>

{#snippet heading(id: Section | "hotkeys", flag: Flag)}
  <div class="h">
    <h2>{tr(NAV_KEYS[id])}</h2>
    <span class="flag" class:bad={flag === "failed"} role="status">{flag ? flagText(flag) : ""}</span>
  </div>
{/snippet}

{#snippet modelCard(kind: "pageModel" | "selectionModel", title: string)}
  {@const current = globals?.[kind] ?? null}
  {@const info = current
    ? models.find((m) => m.providerID === current.providerID && m.id === current.id)
    : undefined}
  {@const variants = info?.variants ?? []}
  <div class="box card">
    <div class="ct">{title}</div>
    <div>
      <span class="lbl">{tr("popup.model")}</span>
      <ModelSelect
        {models}
        value={current}
        label={`${title}: ${tr("popup.model")}`}
        onchange={(m) => setModel(kind, m)}
      />
    </div>
    <div>
      <span class="lbl">{tr("popup.effort")}</span>
      {#if variants.length > 0}
        <Segmented
          value={current?.variant ?? ""}
          options={variants.map((v) => ({ value: v, label: v }))}
          label={`${title}: ${tr("popup.effort")}`}
          onchange={(v) => setVariant(kind, v)}
        />
      {:else if models.length > 0 && current}
        <div class="mu small">{tr("models.noEffort")}</div>
      {:else}
        <div class="mu small">{current?.variant ?? "-"}</div>
      {/if}
    </div>
    {#if current?.variant === "none"}
      <div class="mu small">{tr("models.noneNote")}</div>
    {:else if current?.variant}
      <div class="mu small">{tr("models.slowNote")}</div>
    {/if}
  </div>
{/snippet}

<div class="page">
  <div class="wrap">
    <header>
      <h1>{tr("opt.title")}</h1>
      <div class="mu">{tr("opt.subtitle")}</div>
    </header>

    {#if !loaded}
      <div class="mu" role="status">{tr("selection.loading")}</div>
    {:else if loadFailed || !globals}
      <div class="box fail" role="alert">
        <div class="strong">{tr("opt.loadFailed.title")}</div>
        <div class="mu">{tr("popup.loadFailed")}</div>
        <div><button type="button" class="btn" onclick={load}>{tr("common.retry")}</button></div>
      </div>
    {:else}
      <div class="layout">
        <nav aria-label={tr("opt.sections")}>
          {#each SECTIONS as id (id)}
            <a href={`#${id}`} class:on={active === id} onclick={() => (active = id)}>
              {tr(NAV_KEYS[id])}
            </a>
          {/each}
        </nav>

        <div class="main">
          <section class="sec first" id="connection">
            {@render heading("connection", flags.connection)}
            <div class="box conn">
              <div class="col">
                <div class="state">
                  <StatusDot tone={connected ? "ok" : "er"} />
                  <span>
                    {#if connected}{tr("status.connected")}
                    {:else if failure}{failure.title}
                    {:else}{tr("status.disconnected")}{/if}
                  </span>
                </div>
                <div class="mono mu">
                  {#if status?.state === "connected"}
                    {tr("opt.connection.version", { version: status.version, url: status.url })}
                  {:else if status?.state === "error"}
                    {status.url}{failure?.hint ? ` · ${failure.hint}` : ""}
                  {:else}
                    {tr("opt.connection.notConnected")}
                  {/if}
                </div>
              </div>
              <div class="btns">
                <button type="button" class="btn" onclick={openOnboarding}>
                  {status?.state === "disconnected" ? tr("popup.connectOpencode") : tr("opt.connection.reconnect")}
                </button>
                {#if status?.state !== "disconnected"}
                  <button type="button" class="btn dng" onclick={disconnect}>
                    {tr("opt.connection.disconnect")}
                  </button>
                {/if}
              </div>
            </div>
          </section>

          <section class="sec" id="language">
            {@render heading("language", flags.language)}
            <div class="grid3">
              <div>
                <span class="lbl">{tr("opt.lang.ui")}</span>
                <Segmented
                  value={globals.uiLang}
                  options={uiOptions}
                  label={tr("opt.lang.ui")}
                  onchange={pickUiLang}
                />
              </div>
              <label class="block">
                <span class="lbl">{tr("opt.lang.source")}</span>
                <select
                  class="fld"
                  value={globals.sourceLang}
                  onchange={(e) => patchGlobals("language", { sourceLang: e.currentTarget.value })}
                >
                  <option value="auto">{tr("opt.lang.sourceAuto")}</option>
                  {#each languageOptions(globals.sourceLang === "auto" ? "en" : globals.sourceLang) as l (l.code)}
                    <option value={l.code}>{l.name}</option>
                  {/each}
                </select>
              </label>
              <label class="block">
                <span class="lbl">{tr("opt.lang.target")}</span>
                <select
                  class="fld"
                  value={globals.targetLang}
                  onchange={(e) => patchGlobals("language", { targetLang: e.currentTarget.value })}
                >
                  {#each languageOptions(globals.targetLang) as l (l.code)}
                    <option value={l.code}>{l.name}</option>
                  {/each}
                </select>
              </label>
            </div>
            <p class="mu small hintline">{tr("opt.lang.hint")}</p>
          </section>

          <section class="sec" id="models">
            {@render heading("models", flags.models)}
            <p class="lead mu">{tr("models.lead")}</p>
            <div class="note gap">
              <b>{tr("models.thinkingTitle")}</b>
              {tr("models.thinkingHint")}
            </div>
            {#if models.length === 0}
              <div class="mu small gap">{tr("models.unavailable")}</div>
            {/if}
            <div class="cards">
              {@render modelCard("pageModel", tr("models.page"))}
              {@render modelCard("selectionModel", tr("models.selection"))}
            </div>
          </section>

          <section class="sec" id="templates">
            {@render heading("templates", flags.templates)}
            <p class="lead mu">{tr("opt.tpl.lead")}</p>
            <TemplateEditor
              {templates}
              {globals}
              {models}
              {rules}
              onop={templateOp}
              onsetdefault={(id) => patchGlobals("templates", { defaultTemplateId: id })}
            />
          </section>

          <section class="sec" id="rules">
            {@render heading("rules", flags.rules)}
            <p class="lead mu">{tr("opt.rules.lead")}</p>
            <SiteRules
              {rules}
              {templates}
              defaultTemplateId={globals.defaultTemplateId}
              onop={ruleOp}
            />
          </section>

          <section class="sec" id="cache">
            {@render heading("cache", flags.cache)}
            <p class="lead mu">{tr("opt.cache.lead")}</p>
            <div class="box conn gap">
              <div>
                <div class="mu small">{tr("opt.cache.size")}</div>
                <div class="strong">
                  {tr("opt.cache.entries", { count: cacheEntries.toLocaleString(resolveLang()) })}
                </div>
              </div>
              <button type="button" class="btn" onclick={clearCache}>{tr("opt.cache.clear")}</button>
            </div>
          </section>

          <section class="sec last" id="hotkeys">
            {@render heading("hotkeys", null)}
            <div class="tbl">
              {#each shortcuts as s (s.name)}
                <div class="krow">
                  <span class="kl">{commandLabel(s.name, s.description)}</span>
                  <span class="kr">
                    {#if s.shortcut}
                      <kbd>{s.shortcut}</kbd>
                    {:else}
                      <span class="mu small">{tr("opt.hotkeys.notSet")}</span>
                    {/if}
                    {#if !firefox}
                      <button type="button" class="btn sm" onclick={openShortcuts}>
                        {tr("opt.hotkeys.change")}
                      </button>
                    {/if}
                  </span>
                </div>
              {/each}
              <div class="krow">
                <span class="kl">{tr("opt.hotkeys.closeCard")}</span>
                <span class="kr">
                  <kbd>Esc</kbd>
                  {#if !firefox}
                    <button type="button" class="btn sm" disabled>{tr("opt.hotkeys.change")}</button>
                  {/if}
                </span>
              </div>
            </div>
            <p class="mu small hintline">
              {firefox ? tr("opt.hotkeys.noteFirefox") : tr("opt.hotkeys.noteChrome")}
            </p>
          </section>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .page {
    padding: 40px 32px 64px;
  }
  .wrap {
    max-width: 980px;
    margin: 0 auto;
  }
  header {
    margin-bottom: 32px;
  }
  h1 {
    margin: 0;
    font-size: 22px;
    line-height: 30px;
    font-weight: 600;
  }
  h2 {
    margin: 0;
    font-size: 16px;
    line-height: 24px;
    font-weight: 600;
  }
  .layout {
    display: flex;
    flex-wrap: wrap;
    gap: 32px 48px;
    align-items: flex-start;
  }
  nav {
    flex: 0 0 200px;
    max-width: 100%;
    display: flex;
    flex-direction: column;
    gap: 2px;
    position: sticky;
    top: 24px;
  }
  nav a {
    color: var(--mu);
    text-decoration: none;
    padding: 6px 10px;
    border-radius: 6px;
  }
  nav a.on {
    color: var(--tx);
    background: var(--sf);
    font-weight: 600;
  }
  nav a:focus-visible {
    outline: 2px solid var(--ac);
    outline-offset: 2px;
  }
  .main {
    flex: 999 1 540px;
    min-width: 0;
  }
  .sec {
    border-top: 1px solid var(--bd);
    padding-top: 24px;
    margin-bottom: 40px;
    scroll-margin-top: 16px;
  }
  .sec.first {
    border-top: 0;
    padding-top: 0;
  }
  .sec.last {
    margin-bottom: 0;
  }
  .h {
    display: flex;
    align-items: baseline;
    gap: 12px;
  }
  .flag {
    font-size: 12px;
    color: var(--ok);
  }
  .flag.bad {
    color: var(--er);
  }
  .lead {
    margin: 4px 0 0;
  }
  .gap {
    margin-top: 16px;
  }
  .block {
    display: block;
  }
  .strong {
    font-weight: 600;
  }
  .conn {
    margin-top: 16px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .state {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
  }
  .btns {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .grid3 {
    margin-top: 16px;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
    gap: 16px;
  }
  .hintline {
    margin: 12px 0 0;
  }
  .cards {
    margin-top: 16px;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr));
    gap: 16px;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .ct {
    font-weight: 600;
  }
  .fail {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-start;
  }
  .tbl {
    margin-top: 16px;
    border: 1px solid var(--bd);
    border-radius: 8px;
  }
  .krow {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 16px;
    padding: 10px 16px;
  }
  .krow + .krow {
    border-top: 1px solid var(--bd);
  }
  .kl {
    flex: 1 1 220px;
    min-width: 0;
  }
  .kr {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  kbd {
    font-family: var(--mono);
    font-size: 12px;
    border: 1px solid var(--bd2);
    border-radius: 4px;
    padding: 2px 7px;
    color: var(--tx);
    white-space: nowrap;
  }
</style>
