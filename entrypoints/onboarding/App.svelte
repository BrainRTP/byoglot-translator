<script lang="ts">
  import { onMount } from "svelte";
  import { browser } from "wxt/browser";
  import { resolveLang, type UiLang } from "../../lib/i18n";
  import { type Status, sendMessage } from "../../lib/messaging/protocol";
  import { changeUiLang, tr } from "../../lib/ui/i18n.svelte";
  import { type PairErrorKind, pairErrorView } from "../../lib/ui/pair-errors";
  import Segmented from "../../lib/ui/Segmented.svelte";

  type Failure = { kind: PairErrorKind; host: string };

  const COPIED_MS = 1500;
  const PAIR_COMMAND = "opencode pair";

  let lang = $state<"ru" | "en">(resolveLang());
  let mode = $state<"link" | "manual">("link");
  let phase = $state<"idle" | "connecting" | "success">("idle");
  let link = $state("");
  let url = $state("http://127.0.0.1:4096");
  let username = $state("opencode");
  let password = $state("");
  let failure = $state<Failure | null>(null);
  let connected = $state<{ version: string; host: string } | null>(null);
  let copied = $state(false);

  const canConnect = $derived(
    phase !== "connecting" && (mode === "link" ? link.trim() !== "" : url.trim() !== ""),
  );

  const hostOf = (value: string) => {
    try {
      return new URL(value).host;
    } catch {
      return value;
    }
  };

  onMount(() => {
    void sendMessage("globals", undefined).then((g) => {
      changeUiLang(g.uiLang);
      lang = resolveLang();
      document.documentElement.lang = lang;
    });
  });

  async function pickLang(next: "ru" | "en") {
    changeUiLang(next);
    lang = next;
    document.documentElement.lang = next;
    const g = await sendMessage("globals", undefined);
    await sendMessage("setGlobals", { ...g, uiLang: next satisfies UiLang });
  }

  async function connect() {
    if (!canConnect) return;
    phase = "connecting";
    failure = null;
    let result: Status;
    try {
      result =
        mode === "link"
          ? await sendMessage("pair", link)
          : await sendMessage("connectManual", {
              url: url.trim().replace(/\/+$/, ""),
              username: username.trim() || "opencode",
              password,
            });
    } catch {
      result = { state: "error", url: "", kind: "offline", backend: "opencode" };
    }
    if (result.state === "connected") {
      connected = { version: result.version, host: hostOf(result.url) };
      link = "";
      password = "";
      phase = "success";
      return;
    }
    phase = "idle";
    const kind = result.state === "error" ? result.kind : "bad_response";
    failure = {
      kind: pairErrorView(kind, mode).kind,
      host: hostOf(result.state === "error" && result.url ? result.url : url),
    };
  }

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(PAIR_COMMAND);
      copied = true;
      setTimeout(() => (copied = false), COPIED_MS);
    } catch {}
  }

  function clearFailure() {
    failure = null;
  }

  function onLinkKey(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void connect();
    }
  }

  function switchMode(next: "link" | "manual") {
    mode = next;
    failure = null;
  }

  async function finish() {
    try {
      const current = await browser.tabs.getCurrent();
      if (current?.id !== undefined) {
        await browser.tabs.remove(current.id);
        return;
      }
    } catch {}
    window.close();
  }

  function openSettings() {
    void sendMessage("openOptions", undefined).catch(() => {});
  }

  const connectLabel = $derived(
    failure?.kind === "unreachable" && mode === "link" ? tr("common.retry") : tr("onboarding.connect"),
  );
</script>

<div class="page">
  <header>
    <span class="strong">{tr("app.name")}</span>
    <Segmented
      size="sm"
      label={tr("onboarding.langSwitch")}
      value={lang}
      options={[
        { value: "ru", label: "RU" },
        { value: "en", label: "EN" },
      ]}
      onchange={pickLang}
    />
  </header>

  <main>
    <div class="col">
      <div class="intro">
        <h1>{tr("onboarding.title")}</h1>
        <p>{tr("onboarding.intro")}</p>
      </div>

      {#if phase === "success" && connected}
        <div class="body">
          <div class="ok-box">
            <div class="ok-title"><span class="dot"></span>{tr("status.connected")}</div>
            <div class="mono muted">opencode {connected.version} · {connected.host}</div>
          </div>
          <p class="muted hint">{tr("onboarding.successHint")}</p>
          <button class="btn pri" type="button" onclick={finish}>{tr("onboarding.done")}</button>
          <div><button class="lnk" type="button" onclick={openSettings}>{tr("onboarding.openSettings")}</button></div>
        </div>
      {:else}
        <div class="body">
          {#if mode === "link"}
            <div class="step">
              <div class="num">1</div>
              <div class="strong">{tr("onboarding.step1")}</div>
              <div></div>
              <div class="code">
                <span class="mono big">{PAIR_COMMAND}</span>
                <button class="btn sm" type="button" onclick={copyCommand}>
                  {copied ? tr("onboarding.copied") : tr("onboarding.copy")}
                </button>
              </div>
            </div>
            <div class="step">
              <div class="num">2</div>
              <div class="strong">{tr("onboarding.step2")}</div>
              <div></div>
              <div class="stack">
                <textarea
                  class="fld mono big"
                  class:err={failure !== null}
                  rows="1"
                  spellcheck="false"
                  aria-label={tr("onboarding.linkLabel")}
                  placeholder={tr("onboarding.linkPlaceholder")}
                  disabled={phase === "connecting"}
                  bind:value={link}
                  oninput={clearFailure}
                  onkeydown={onLinkKey}
                ></textarea>
                {#if failure}
                  {@render alert(failure)}
                {/if}
                <button class="btn pri" type="button" disabled={!canConnect} onclick={connect}>
                  {#if phase === "connecting"}
                    <span class="spin"></span>{tr("onboarding.connecting")}
                  {:else}
                    {connectLabel}
                  {/if}
                </button>
              </div>
            </div>
          {:else}
            <label class="field">
              <span class="strong">{tr("onboarding.server")}</span>
              <input class="fld mono big" type="text" spellcheck="false" bind:value={url} oninput={clearFailure} />
            </label>
            <label class="field">
              <span class="strong">{tr("onboarding.username")}</span>
              <input class="fld mono big" type="text" spellcheck="false" autocomplete="username" bind:value={username} oninput={clearFailure} />
            </label>
            <label class="field">
              <span class="strong">{tr("onboarding.password")} <span class="muted plain">{tr("onboarding.ifSet")}</span></span>
              <input class="fld mono big" type="password" autocomplete="current-password" bind:value={password} oninput={clearFailure} />
            </label>
            {#if failure}
              {@render alert(failure)}
            {/if}
            <button class="btn pri" type="button" disabled={!canConnect} onclick={connect}>
              {#if phase === "connecting"}
                <span class="spin"></span>{tr("onboarding.connecting")}
              {:else}
                {tr("onboarding.connect")}
              {/if}
            </button>
          {/if}
          <div>
            <button class="lnk" type="button" onclick={() => switchMode(mode === "link" ? "manual" : "link")}>
              {mode === "link" ? tr("onboarding.manual") : tr("onboarding.byLink")}
            </button>
          </div>
        </div>
      {/if}
    </div>
  </main>

  <footer>{tr("onboarding.footer")}</footer>
</div>

{#snippet alert(f: Failure)}
  <div class="alert" role="alert">
    {#if f.kind === "expired"}
      <b>{tr("onboarding.expired.title")}</b>
      <div>{tr("onboarding.expiredBefore")} <span class="mono big">{PAIR_COMMAND}</span> {tr("onboarding.expiredAfter")}</div>
    {:else if f.kind === "unreachable"}
      <b>{tr("onboarding.unreachable.title")}</b>
      <div>{tr("onboarding.unreachable", { host: f.host })}</div>
    {:else if f.kind === "badPassword"}
      <b>{tr("onboarding.badPassword.title")}</b>
      <div>{tr("onboarding.badPassword")}</div>
    {:else if f.kind === "incompatible"}
      <b>{tr("error.incompatible.title")}</b>
      <div>{tr("error.incompatible")}</div>
    {:else}
      <b>{tr("onboarding.badLink.title")}</b>
      <div>{tr("onboarding.badLink")}</div>
    {/if}
  </div>
{/snippet}

<style>
  :global(body) {
    font-size: 14px;
    line-height: 1.5;
  }
  .page {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 20px 32px;
  }
  main {
    flex: 1 1 auto;
    display: flex;
    justify-content: center;
    padding: 56px 24px 72px;
  }
  .col {
    width: 100%;
    max-width: 520px;
    display: flex;
    flex-direction: column;
    gap: 32px;
  }
  .intro {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  h1 {
    margin: 0;
    font-size: 30px;
    line-height: 38px;
    font-weight: 600;
  }
  .intro p {
    margin: 0;
    color: var(--mu);
    font-size: 15px;
    line-height: 23px;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 28px;
  }
  footer {
    padding: 20px 32px;
    color: var(--mu);
    font-size: 12px;
    border-top: 1px solid var(--bd);
  }
  .strong {
    font-weight: 600;
  }
  .muted {
    color: var(--mu);
  }
  .plain {
    font-weight: 400;
  }
  .num {
    color: var(--mu);
    font-variant-numeric: tabular-nums;
  }
  .step {
    display: grid;
    grid-template-columns: 20px minmax(0, 1fr);
    gap: 10px 12px;
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .code {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    background: var(--sf);
    border: 1px solid var(--bd);
    border-radius: 6px;
    padding: 7px 7px 7px 14px;
  }
  .big {
    font-size: 13px;
  }
  .btn {
    font-size: 14px;
    min-height: 44px;
    height: auto;
    padding: 4px 16px;
    line-height: 1.3;
  }
  .btn.sm {
    min-height: 30px;
    padding: 3px 12px;
    font-size: 12px;
  }
  .btn.pri {
    width: 100%;
  }
  .fld {
    font: inherit;
    font-size: 14px;
    min-height: 44px;
    width: 100%;
    min-width: 0;
    border: 1px solid var(--bd2);
    border-radius: 6px;
    background: var(--bg);
    color: var(--tx);
    padding: 0 12px;
  }
  .fld.mono {
    font-family: var(--mono);
    font-size: 13px;
  }
  textarea.fld {
    field-sizing: content;
    max-height: 140px;
    padding: 11px 12px;
    resize: none;
    display: block;
    line-height: 1.4;
  }
  .fld.err {
    border-color: var(--er);
  }
  .fld::placeholder {
    color: var(--mu);
    opacity: 1;
  }
  .fld:focus-visible {
    outline: 2px solid var(--ac);
    outline-offset: 2px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .alert {
    background: var(--ers);
    border: 1px solid var(--er);
    border-radius: 6px;
    padding: 10px 12px;
  }
  .alert b {
    color: var(--er);
    font-weight: 600;
    display: block;
  }
  .ok-box {
    background: var(--sf);
    border: 1px solid var(--bd);
    border-radius: 6px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .ok-title {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--ok);
    font-weight: 600;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--ok);
    flex: none;
  }
  .hint {
    margin: 0;
  }
</style>
