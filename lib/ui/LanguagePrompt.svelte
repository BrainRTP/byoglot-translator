<script lang="ts">
  import { tick } from "svelte";
  import type { LanguageProfileView, ProfileOp } from "../messaging/protocol";
  import { autoProfile, GENERIC_PROFILE, MAX_PROFILE_TEXT } from "../settings/language-prompt";
  import type { GlobalSettings } from "../settings/types";
  import { tr } from "./i18n.svelte";
  import {
    buttons,
    CONTRIBUTING_URL,
    createDrafts,
    editedProfile,
    noProfileText,
    normalizedChoice,
    profileLabel,
    showNoProfile,
    showOtherLang,
  } from "./language-prompt-logic";

  let {
    profiles,
    globals,
    onop,
    onpatch,
  }: {
    profiles: LanguageProfileView[];
    globals: GlobalSettings;
    onop: (op: ProfileOp) => Promise<LanguageProfileView[] | null>;
    onpatch: (patch: Partial<GlobalSettings>) => void;
  } = $props();

  const drafts = createDrafts();
  let revision = $state(0);
  let confirming = $state(false);
  let textarea = $state<HTMLTextAreaElement>();
  let resetButton = $state<HTMLButtonElement>();

  const enabled = $derived(globals.languagePromptEnabled);
  const ids = $derived(profiles.map((p) => p.id));
  const choice = $derived(normalizedChoice(globals.languageProfile, ids));
  const editedId = $derived(editedProfile(choice, globals.targetLang, ids));
  const edited = $derived(profiles.find((p) => p.id === editedId));
  const saved = $derived(edited?.text ?? "");
  const draft = $derived.by(() => {
    void revision;
    return drafts.get(editedId) ?? saved;
  });
  const shown = $derived(buttons({ draft, saved, modified: edited?.modified ?? false }));

  // languageName() is not reactive, so the names also read the interface language
  const names = $derived.by(() => {
    void globals.uiLang;
    return new Map(profiles.map((p) => [p.id, profileLabel(p.id)]));
  });
  const nameOf = (id: string) => names.get(id) ?? id;
  const optionLabel = (p: LanguageProfileView) =>
    p.modified ? tr("opt.lp.modifiedName", { name: nameOf(p.id) }) : nameOf(p.id);
  const languages = $derived(profiles.filter((p) => p.id !== GENERIC_PROFILE));
  const fallback = $derived(profiles.filter((p) => p.id === GENERIC_PROFILE));

  const noProfile = $derived(enabled && showNoProfile(choice, globals.targetLang, ids));
  const otherLang = $derived(enabled && showOtherLang(choice, globals.targetLang));

  $effect(() => {
    void editedId;
    void enabled;
    confirming = false;
  });

  function setDraft(text: string) {
    if (text === saved) drafts.drop(editedId);
    else drafts.set(editedId, text);
    revision++;
  }

  function dropDraft(id: string) {
    drafts.drop(id);
    revision++;
  }

  async function save() {
    const id = editedId;
    const text = draft;
    if ((await onop({ type: "save", id, text })) === null) return;
    if (drafts.get(id) === text) dropDraft(id);
  }

  async function keep() {
    await onop({ type: "keep", id: editedId });
  }

  async function confirmReset() {
    const id = editedId;
    const list = await onop({ type: "reset", id });
    if (list !== null) dropDraft(id);
    confirming = false;
    await tick();
    (list === null ? resetButton : textarea)?.focus();
  }

  async function cancelReset() {
    confirming = false;
    await tick();
    resetButton?.focus();
  }

  function focusOnMount(node: HTMLElement) {
    node.focus();
  }

  function onConfirmKey(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    e.preventDefault();
    void cancelReset();
  }
</script>

<div class="lp">
  <p class="mu lead">{tr("opt.lp.lead")}</p>

  <div class="toggle">
    <label class="tl">
      <button
        type="button"
        class="sw"
        class:on={enabled}
        role="switch"
        aria-checked={enabled}
        aria-labelledby="lp-enabled"
        onclick={() => onpatch({ languagePromptEnabled: !enabled })}
      >
        <i></i>
      </button>
      <span class="tt" id="lp-enabled">{tr("opt.lp.enabled")}</span>
    </label>
    {#if !enabled}
      <div class="off">{tr("opt.lp.off")}</div>
    {/if}
  </div>

  <div class="body" class:dim={!enabled}>
    <div>
      <label class="lbl" for="lp-profile">{tr("opt.lp.profile")}</label>
      <div class="pick">
        <select
          id="lp-profile"
          class="fld"
          value={choice}
          disabled={!enabled}
          onchange={(e) => onpatch({ languageProfile: e.currentTarget.value })}
        >
          <option value="auto">
            {tr("opt.lp.auto", { name: nameOf(autoProfile(globals.targetLang, ids)) })}
          </option>
          {#if languages.length > 0}
            <optgroup label={tr("opt.lp.groupLangs")}>
              {#each languages as p (p.id)}
                <option value={p.id}>{optionLabel(p)}</option>
              {/each}
            </optgroup>
          {/if}
          {#if fallback.length > 0}
            <optgroup label={tr("opt.lp.groupFallback")}>
              {#each fallback as p (p.id)}
                <option value={p.id}>{optionLabel(p)}</option>
              {/each}
            </optgroup>
          {/if}
        </select>
        <span class="chip">
          {edited?.modified ? tr("opt.lp.tagModified") : tr("opt.lp.tagBuiltin")}
        </span>
      </div>
      {#if noProfile}
        <div class="hint">
          {noProfileText(globals.targetLang)}
          {#if CONTRIBUTING_URL}
            <a class="lnk" href={CONTRIBUTING_URL} target="_blank" rel="noopener">
              {tr("opt.lp.help")}
            </a>
          {/if}
        </div>
      {/if}
      {#if otherLang}
        <div class="hint">{tr("opt.lp.otherLang", { name: nameOf(choice) })}</div>
      {/if}
      {#if edited?.outdated}
        <div class="hint">
          {tr("opt.lp.outdated", { name: nameOf(editedId) })}
          <button
            type="button"
            class="lnk"
            disabled={!enabled}
            onclick={() => setDraft(edited.builtin)}
          >
            {tr("opt.lp.openNew")}
          </button>
          <button type="button" class="lnk" disabled={!enabled} onclick={keep}>
            {tr("opt.lp.keepMine")}
          </button>
        </div>
      {/if}
    </div>

    <label class="blk">
      <span class="lbl">{tr("opt.lp.text")}</span>
      <textarea
        bind:this={textarea}
        class="fld"
        rows="13"
        spellcheck="false"
        maxlength={MAX_PROFILE_TEXT}
        disabled={!enabled}
        value={draft}
        oninput={(e) => setDraft(e.currentTarget.value)}
      ></textarea>
    </label>

    {#if confirming}
      <div
        class="confirm"
        role="alertdialog"
        aria-labelledby="lp-confirm"
        tabindex="-1"
        onkeydown={onConfirmKey}
      >
        <div id="lp-confirm">{tr("opt.lp.confirmReset", { name: nameOf(editedId) })}</div>
        <div class="row">
          <button type="button" class="btn sm dng" onclick={confirmReset}>
            {tr("opt.lp.confirmYes")}
          </button>
          <button type="button" class="btn sm" use:focusOnMount onclick={cancelReset}>
            {tr("opt.lp.confirmNo")}
          </button>
        </div>
      </div>
    {:else}
      <div class="row">
        <button
          type="button"
          class="btn pri"
          disabled={!enabled || !shown.save}
          onclick={save}
        >
          {tr("opt.lp.save")}
        </button>
        {#if shown.discard}
          <button
            type="button"
            class="btn"
            disabled={!enabled}
            onclick={() => dropDraft(editedId)}
          >
            {tr("opt.lp.discard")}
          </button>
        {/if}
        {#if shown.reset}
          <button
            type="button"
            class="btn"
            bind:this={resetButton}
            disabled={!enabled}
            onclick={() => (confirming = true)}
          >
            {tr("opt.lp.reset")}
          </button>
        {/if}
      </div>
    {/if}
  </div>

  <div class="note">
    <b>{tr("opt.lp.orderTitle")}</b>
    {tr("opt.lp.orderText")}
  </div>
</div>

<style>
  .lp {
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .lead {
    margin: 0;
  }
  .toggle {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .tl {
    display: flex;
    align-items: center;
    gap: 12px;
    cursor: pointer;
  }
  .tt {
    font-weight: 600;
  }
  .off {
    color: var(--mu);
    padding-left: 52px;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .pick {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .hint {
    margin-top: 8px;
    color: var(--mu);
    font-size: 12px;
  }
  .hint button.lnk {
    margin-left: 8px;
  }
  .lnk:disabled {
    cursor: default;
  }
  .blk {
    display: block;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .confirm {
    background: var(--sf);
    border: 1px solid var(--bd2);
    border-radius: 6px;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .confirm .btn.sm {
    font-size: 13px;
    padding: 3px 12px;
  }
  .confirm .btn.dng {
    border-color: var(--er);
  }
</style>
