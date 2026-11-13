<script lang="ts">
  import type { ConnectionView, ProviderPreset } from "../connections/types";
  import type { ProviderInput, Status } from "../messaging/protocol";
  import { needsKey } from "../provider/presets";
  import { cleartextSecret, presetDefaults, validateProviderForm } from "./connection-logic";
  import { describeError } from "./errors";
  import { requestOrigin } from "./host-permission";
  import { tr } from "./i18n.svelte";
  import { statusFailure } from "./popup-logic";

  const PRESETS: ProviderPreset[] = ["deepseek", "openrouter", "openai", "mistral", "ollama", "lmstudio", "custom"];

  let {
    existing,
    onsave,
    ondone,
    oncancel,
  }: {
    existing?: ConnectionView;
    onsave: (input: ProviderInput) => Promise<Status>;
    ondone: (status: Status) => void;
    oncancel?: () => void;
  } = $props();

  const initial = (() => existing)();
  const first = initial?.preset ?? "deepseek";
  let preset = $state<ProviderPreset>(first);
  let baseUrl = $state(initial?.url ?? presetDefaults(first).baseUrl);
  let name = $state(initial?.name ?? presetDefaults(first).name);
  let apiKey = $state("");
  let busy = $state(false);
  let invalid = $state<"baseUrl" | "apiKey" | null>(null);
  let denied = $state("");
  let failed = $state<{ title: string; body: string } | null>(null);
  let previous = first;

  const keyRequired = $derived(needsKey(preset, baseUrl));
  const keyHint = $derived(
    existing?.hasKey ? tr("conn.form.keyKeep") : keyRequired ? "" : tr("conn.form.keyOptional"),
  );

  const cleartext = $derived(cleartextSecret(baseUrl, apiKey, existing?.hasKey === true));

  function resetFeedback() {
    invalid = null;
    denied = "";
    failed = null;
  }

  function pickPreset(event: Event) {
    const next = (event.currentTarget as HTMLSelectElement).value as ProviderPreset;
    const old = presetDefaults(previous);
    const fresh = presetDefaults(next);
    if (baseUrl.trim() === "" || baseUrl === old.baseUrl) baseUrl = fresh.baseUrl;
    if (name.trim() === "" || name === old.name) name = fresh.name;
    preset = next;
    previous = next;
    resetFeedback();
  }

  async function submit(event: Event) {
    event.preventDefault();
    if (busy) return;
    resetFeedback();
    const input: ProviderInput = {
      ...(existing && { id: existing.id }),
      preset,
      name: name.trim() || presetDefaults(preset).name,
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
    };
    const check = validateProviderForm({ preset, name: input.name, baseUrl: input.baseUrl, apiKey: input.apiKey }, existing);
    if (!check.ok) {
      invalid = check.field;
      return;
    }
    busy = true;
    try {
      const granted = await requestOrigin(input.baseUrl);
      if (!granted) {
        denied = tr("conn.accessDenied", { host: new URL(input.baseUrl).host });
        return;
      }
      const status = await onsave(input);
      if (status.state === "connected") {
        apiKey = "";
        ondone(status);
        return;
      }
      const view =
        statusFailure(status) ?? describeError("bad_response", "popup", undefined, Date.now(), "provider");
      failed = { title: view.title, body: view.body };
    } catch {
      const view = describeError("offline", "popup", undefined, Date.now(), "provider");
      failed = { title: view.title, body: view.body };
    } finally {
      busy = false;
    }
  }
</script>

<form class="pf" onsubmit={submit}>
  <label class="field">
    <span class="lbl">{tr("conn.form.preset")}</span>
    <select class="ctl" value={preset} disabled={busy} onchange={pickPreset}>
      {#each PRESETS as p (p)}
        <option value={p}>{tr(`conn.preset.${p}`)}</option>
      {/each}
    </select>
  </label>
  <label class="field">
    <span class="lbl">{tr("conn.form.baseUrl")}</span>
    <input
      class="ctl mono"
      type="text"
      spellcheck="false"
      autocomplete="off"
      aria-invalid={invalid === "baseUrl"}
      disabled={busy}
      bind:value={baseUrl}
      oninput={resetFeedback}
    />
    {#if invalid === "baseUrl"}<span class="err" role="alert">{tr("conn.form.baseUrlInvalid")}</span>{/if}
    {#if cleartext}<span class="err">{tr("conn.form.cleartext")}</span>{/if}
  </label>
  <label class="field">
    <span class="lbl">{tr("conn.form.apiKey")}</span>
    <input
      class="ctl mono"
      type="password"
      autocomplete="off"
      aria-invalid={invalid === "apiKey"}
      disabled={busy}
      bind:value={apiKey}
      oninput={resetFeedback}
    />
    {#if invalid === "apiKey"}
      <span class="err" role="alert">{tr("conn.form.keyRequired")}</span>
    {:else if keyHint}
      <span class="hint">{keyHint}</span>
    {/if}
  </label>
  <label class="field">
    <span class="lbl">{tr("conn.form.name")}</span>
    <input class="ctl" type="text" autocomplete="off" disabled={busy} bind:value={name} oninput={resetFeedback} />
  </label>

  {#if denied}
    <div class="alert" role="alert">{denied}</div>
  {/if}
  {#if failed}
    <div class="alert" role="alert"><b>{failed.title}</b><div>{failed.body}</div></div>
  {/if}

  <div class="btns">
    <button class="btn pri" type="submit" disabled={busy}>
      {#if busy}<span class="spin"></span>{tr("conn.form.saving")}{:else}{tr("conn.form.save")}{/if}
    </button>
    {#if oncancel}
      <button class="btn" type="button" disabled={busy} onclick={oncancel}>{tr("common.cancel")}</button>
    {/if}
  </div>
</form>

<style>
  .pf {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .lbl {
    font-weight: 600;
  }
  .ctl {
    font: inherit;
    font-size: 14px;
    min-height: 40px;
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    border: 1px solid var(--bd2);
    border-radius: 6px;
    background: var(--bg);
    color: var(--tx);
    padding: 0 12px;
  }
  .ctl.mono {
    font-family: var(--mono);
    font-size: 13px;
  }
  .ctl:focus-visible {
    outline: 2px solid var(--ac);
    outline-offset: 2px;
  }
  .ctl[aria-invalid="true"] {
    border-color: var(--er);
  }
  .ctl:disabled {
    background: var(--sf);
    color: var(--mu);
  }
  .hint {
    color: var(--mu);
    font-size: 12px;
  }
  .err {
    color: var(--er);
    font-size: 12px;
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
  .btns {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .btn {
    min-height: 40px;
  }
</style>
