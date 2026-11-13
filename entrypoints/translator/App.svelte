<script lang="ts">
  import { onMount } from "svelte";
  import { resolveLang } from "../../lib/i18n";
  import { sendMessage } from "../../lib/messaging/protocol";
  import { MAX_EDITOR_TEXT } from "../../lib/selection/limits";
  import { builtinTemplate, DEFAULT_GLOBALS } from "../../lib/settings/defaults";
  import type { Template } from "../../lib/settings/types";
  import { createTranslator, type TranslatorState, translatorDefaults } from "../../lib/translator/controller";
  import { textProblem } from "../../lib/translator/input";
  import { changeUiLang, tr } from "../../lib/ui/i18n.svelte";
  import { languageOptions } from "../../lib/ui/languages";
  import { isAndroid } from "../../lib/ui/platform";
  import { applyTheme } from "../../lib/ui/theme";

  let templates = $state<Template[]>([builtinTemplate()]);
  let loaded = $state(false);
  let loadFailed = $state(false);
  let android = $state(false);
  let copyStatus = $state<"copied" | "copyFailed" | null>(null);
  const initial = translatorDefaults(DEFAULT_GLOBALS, [builtinTemplate()]);
  let view = $state<TranslatorState>({ ...initial, running: false, result: "", error: null });
  const translator = createTranslator(initial, {
    translate: (input) => sendMessage("translateSelection", input),
    cancel: (id) => sendMessage("cancelSelection", id),
  }, (next) => { view = next; copyStatus = null; });
  const problem = $derived(textProblem(view.text));
  const sources = $derived(languageOptions(view.sourceLang === "auto" ? "en" : view.sourceLang));

  async function load() {
    loadFailed = false;
    try {
      const [globals, list, mobile] = await Promise.all([
        sendMessage("globals", undefined), sendMessage("templates", undefined), isAndroid(),
      ]);
      templates = list.length ? list : [builtinTemplate()];
      android = mobile;
      changeUiLang(globals.uiLang);
      document.documentElement.lang = resolveLang();
      document.title = `${tr("translator.title")} | ByoGlot Translator`;
      applyTheme(document.documentElement, globals.theme);
      translator.update(translatorDefaults(globals, templates));
    } catch {
      loadFailed = true;
    } finally {
      loaded = true;
    }
  }

  onMount(() => {
    void load();
    return () => translator.cancel();
  });

  async function copy() {
    try {
      await navigator.clipboard.writeText(view.result);
      copyStatus = "copied";
    } catch {
      copyStatus = "copyFailed";
    }
  }
</script>

<svelte:window onpagehide={() => translator.cancel()} />

<main class:android>
  <header>
    <h1>{tr("translator.title")}</h1>
    <button class="btn" type="button" onclick={() => sendMessage("openOptions", undefined)}>{tr("common.settings")}</button>
  </header>
  {#if !loaded}
    <div role="status">{tr("popup.loading")}</div>
  {:else if loadFailed}
    <div class="box" role="alert">
      <p>{tr("popup.loadFailed")}</p>
      <button class="btn" type="button" onclick={load}>{tr("common.retry")}</button>
    </div>
  {:else}
    <div class="controls">
      <label><span class="lbl">{tr("translator.source")}</span>
        <select class="fld" value={view.sourceLang} onchange={(e) => translator.update({ sourceLang: e.currentTarget.value })}>
          <option value="auto">{tr("selection.auto")}</option>
          {#each sources as language (language.code)}<option value={language.code}>{language.name}</option>{/each}
        </select>
      </label>
      <label><span class="lbl">{tr("translator.target")}</span>
        <select class="fld" value={view.targetLang} onchange={(e) => translator.update({ targetLang: e.currentTarget.value })}>
          {#each languageOptions(view.targetLang) as language (language.code)}<option value={language.code}>{language.name}</option>{/each}
        </select>
      </label>
      <label><span class="lbl">{tr("selection.template")}</span>
        <select class="fld" value={view.templateId} onchange={(e) => translator.update({ templateId: e.currentTarget.value })}>
          {#each templates as template (template.id)}<option value={template.id}>{template.builtin ? tr("template.builtin") : template.name}</option>{/each}
        </select>
      </label>
    </div>
    <div>
      <label class="lbl" for="source-text">{tr("translator.input")}</label>
      <textarea id="source-text" class="fld" rows="10" value={view.text} autocomplete="off" placeholder={tr("translator.placeholder")} aria-describedby="text-count text-limit" aria-invalid={problem === "tooLong"} oninput={(e) => translator.update({ text: e.currentTarget.value })}></textarea>
      <div class="mu small count" id="text-count">{tr("translator.count", { count: view.text.length, limit: MAX_EDITOR_TEXT })}</div>
      <div id="text-limit" role="alert" class="err">{problem === "tooLong" ? tr("translator.limit", { limit: MAX_EDITOR_TEXT }) : ""}</div>
    </div>
    <div>
      <button class="btn pri" type="button" disabled={!view.running && problem !== null} onclick={() => view.running ? translator.cancel() : translator.translate()}>{view.running ? tr("common.cancel") : tr("translator.translate")}</button>
    </div>
    {#if view.error}
      <div class="box failure {view.error.tone}" role="alert">
        <strong>{view.error.title}</strong>
        <div>{view.error.body}</div>
        {#if view.error.hint}<div class="mono">{view.error.hint}</div>{/if}
        {#if view.error.options}<div><button class="btn" type="button" onclick={() => sendMessage("openOptions", undefined)}>{tr("common.settings")}</button></div>{/if}
      </div>
    {/if}
    <section class="box" aria-labelledby="result-title" aria-busy={view.running}>
      <div class="result-head">
        <h2 id="result-title">{tr("translator.result")}</h2>
        <button class="btn" type="button" disabled={!view.result} onclick={copy}>{tr("selection.copy")}</button>
      </div>
      <div class="result" dir="auto" aria-live="polite">{view.result}</div>
      {#if copyStatus}<div role="status" class="mu small">{tr(`selection.${copyStatus}`)}</div>{/if}
    </section>
    <p class="mu small">{tr("translator.privacy")}</p>
  {/if}
</main>

<style>
  main { max-width: 960px; margin: 0 auto; padding: 24px; display: flex; flex-direction: column; gap: 20px; }
  header, .result-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  h1 { font-size: 22px; margin: 0; }
  h2 { font-size: 16px; margin: 0; }
  p { margin: 0; }
  .controls { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
  .count { text-align: right; margin-top: 6px; }
  .result { white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; min-height: 80px; margin-top: 12px; }
  .failure { display: flex; flex-direction: column; gap: 8px; overflow-wrap: anywhere; }
  .failure.er { border-color: var(--er); background: var(--ers); }
  .failure.wn { border-color: var(--wn); background: var(--wns); }
  .android :is(.btn, .fld) { min-height: 44px; }
  @media (pointer: coarse) { .btn, .fld { min-height: 44px; } }
  @media (max-width: 600px) {
    main { padding: 16px; gap: 16px; }
    .controls { grid-template-columns: minmax(0, 1fr); }
  }
</style>
