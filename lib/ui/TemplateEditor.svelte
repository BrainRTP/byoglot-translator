<script lang="ts">
  import type { TemplateOp } from "../messaging/protocol";
  import type { ModelInfo } from "../opencode/types";
  import type { GlobalSettings, SiteRule, Template } from "../settings/types";
  import { tr } from "./i18n.svelte";
  import { languageName, languageOptions } from "./languages";
  import ModelSelect from "./ModelSelect.svelte";
  import {
    filterTemplates,
    formToSettings,
    type ModelId,
    modelVariants,
    reconcileVariant,
    rulesUsing,
    sameForm,
    type TemplateForm,
    templateToForm,
  } from "./options-logic";

  let {
    templates,
    globals,
    models,
    modelsLoading = false,
    rules,
    onop,
    onsetdefault,
  }: {
    templates: Template[];
    globals: GlobalSettings;
    models: ModelInfo[];
    modelsLoading?: boolean;
    rules: SiteRule[];
    onop: (op: TemplateOp) => Promise<Template[] | null>;
    onsetdefault: (id: string) => void;
    } = $props();

  let selectedId = $state<string | null>(null);
  let query = $state("");
  let form = $state<TemplateForm>(templateToForm({ id: "", name: "", builtin: false, settings: {} }));
  let loadedKey = "";

  const nameOf = (t: Template) => (t.builtin ? tr("template.builtin") : t.name);

  const selected = $derived(
    templates.find((t) => t.id === selectedId) ??
      templates.find((t) => t.id === globals.defaultTemplateId) ??
      templates[0],
  );
  const visible = $derived(filterTemplates(templates, query, nameOf));
  const isDefault = $derived(selected?.id === globals.defaultTemplateId);
  const dirty = $derived(selected ? !sameForm(form, templateToForm(selected)) : false);
  const nameMissing = $derived(!selected?.builtin && form.name.trim() === "");
  const pageVariants = $derived(modelVariants(models, form.pageModel));
  const selectionVariants = $derived(modelVariants(models, form.selectionModel));

  $effect(() => {
    const t = selected;
    const key = t ? JSON.stringify(t) : "";
    if (key === loadedKey) return;
    loadedKey = key;
    if (t) form = templateToForm(t);
  });

  const inheritWith = (value: string) => tr("opt.tpl.inheritValue", { value });
  const modelLabel = (m: ModelId | null) => (m ? m.id : "-");
  const modeName = (m: string) => (m === "bilingual" ? tr("popup.modeBilingual") : tr("popup.modeReplace"));

  function effortOptions(variants: string[], chosen: string, inherited: boolean, base: string) {
    const list = chosen !== "" && !variants.includes(chosen) ? [chosen, ...variants] : variants;
    const first = inherited ? inheritWith(base || tr("popup.modelDefault")) : tr("popup.modelDefault");
    return { first, list };
  }

  const pageEffort = $derived(
    effortOptions(pageVariants, form.pageVariant, !form.pageModel, globals.pageModel?.variant ?? ""),
  );
  const selectionEffort = $derived(
    effortOptions(
      selectionVariants,
      form.selectionVariant,
      !form.selectionModel,
      globals.selectionModel?.variant ?? "",
    ),
  );

  const confirmDiscard = () => !dirty || confirm(tr("opt.tpl.confirmDiscard"));

  function select(id: string) {
    if (id === selected?.id || !confirmDiscard()) return;
    selectedId = id;
  }

  function setModel(kind: "page" | "selection", model: ModelId | null) {
    if (kind === "page") {
      form.pageModel = model;
      form.pageVariant = reconcileVariant(models, model, form.pageVariant);
    } else {
      form.selectionModel = model;
      form.selectionVariant = reconcileVariant(models, model, form.selectionVariant);
    }
  }

  async function create() {
    if (!confirmDiscard()) return;
    const before = new Set(templates.map((t) => t.id));
    const next = await onop({ type: "create", name: tr("opt.tpl.new"), settings: {} });
    const added = next?.find((t) => !before.has(t.id));
    if (added) {
      selectedId = added.id;
      query = "";
    }
  }

  async function duplicate() {
    if (!selected || !confirmDiscard()) return;
    const before = new Set(templates.map((t) => t.id));
    const name = tr("opt.tpl.copyName", { name: nameOf(selected) });
    const next = await onop({ type: "duplicate", id: selected.id, name });
    const added = next?.find((t) => !before.has(t.id));
    if (added) {
      selectedId = added.id;
      query = "";
    }
  }

  async function save() {
    if (!selected || nameMissing) return;
    await onop({
      type: "update",
      id: selected.id,
      patch: {
        ...(selected.builtin ? {} : { name: form.name.trim() }),
        settings: formToSettings(form),
      },
    });
  }

  async function remove() {
    if (!selected || selected.builtin) return;
    const count = rulesUsing(rules, selected.id);
    const lines = [tr("opt.tpl.confirmDelete", { name: nameOf(selected) })];
    if (count > 0) lines.push(tr("opt.tpl.confirmDeleteRules", { count }));
    if (!confirm(lines.join("\n"))) return;
    selectedId = null;
    await onop({ type: "delete", id: selected.id });
  }

  async function reset() {
    if (!confirm(tr("opt.tpl.confirmReset"))) return;
    loadedKey = "";
    await onop({ type: "resetBuiltin" });
  }

  const pickSelectValue = (event: Event) => (event.currentTarget as HTMLSelectElement).value;
</script>

<div class="tpl">
  <div class="list">
    <input
      class="fld"
      type="search"
      placeholder={tr("opt.tpl.search")}
      aria-label={tr("opt.tpl.search")}
      bind:value={query}
    />
    <div class="items">
      {#each visible as t (t.id)}
        <button
          type="button"
          class="pl"
          class:on={t.id === selected?.id}
          aria-current={t.id === selected?.id}
          onclick={() => select(t.id)}
        >
          <span>{nameOf(t)}</span>
          {#if t.builtin || t.id === globals.defaultTemplateId}
            <span class="tag">
              {[t.builtin ? tr("opt.tpl.builtinTag") : "", t.id === globals.defaultTemplateId ? tr("opt.tpl.defaultTag") : ""]
                .filter(Boolean)
                .join(" · ")}
            </span>
          {/if}
        </button>
      {:else}
        <div class="mu small empty">{tr("opt.tpl.none")}</div>
      {/each}
    </div>
    <button type="button" class="btn" onclick={create}>{tr("opt.tpl.new")}</button>
  </div>

  {#if selected}
    <div class="editor">
      <label class="block">
        <span class="lbl">{tr("opt.tpl.name")}</span>
        <input
          class="fld"
          type="text"
          readonly={selected.builtin}
          aria-invalid={nameMissing}
          value={selected.builtin ? tr("template.builtin") : form.name}
          oninput={(e) => (form.name = e.currentTarget.value)}
        />
        {#if nameMissing}<div class="err">{tr("opt.tpl.nameRequired")}</div>{/if}
      </label>

      <label class="block">
        <span class="lbl">{tr("popup.prePrompt")}</span>
        <textarea class="fld" rows="6" bind:value={form.prePrompt}></textarea>
        <span class="mu small hint">{tr("opt.tpl.prePromptHint")}</span>
      </label>

      <div class="grid">
        <label class="block">
          <span class="lbl">{tr("opt.tpl.targetLang")}</span>
          <select
            class="fld"
            class:inh={form.targetLang === ""}
            value={form.targetLang}
            onchange={(e) => (form.targetLang = pickSelectValue(e))}
          >
            <option value="">{inheritWith(languageName(globals.targetLang))}</option>
            {#each languageOptions(form.targetLang || globals.targetLang) as l (l.code)}
              <option value={l.code}>{l.name}</option>
            {/each}
          </select>
        </label>

        <label class="block">
          <span class="lbl">{tr("opt.tpl.mode")}</span>
          <select
            class="fld"
            class:inh={form.displayMode === ""}
            value={form.displayMode}
            onchange={(e) => (form.displayMode = pickSelectValue(e) as TemplateForm["displayMode"])}
          >
            <option value="">{inheritWith(modeName(globals.displayMode))}</option>
            <option value="replace">{tr("popup.modeReplace")}</option>
            <option value="bilingual">{tr("popup.modeBilingual")}</option>
          </select>
        </label>

        <div class="block">
          <span class="lbl">{tr("opt.tpl.pageModel")}</span>
          <ModelSelect
            {models}
            loading={modelsLoading}
            value={form.pageModel}
            label={tr("opt.tpl.pageModel")}
            inheritLabel={inheritWith(modelLabel(globals.pageModel))}
            onchange={(m) => setModel("page", m)}
          />
        </div>

        <label class="block">
          <span class="lbl">{tr("opt.tpl.pageEffort")}</span>
          <select
            class="fld"
            class:inh={form.pageVariant === ""}
            disabled={!form.pageModel || (pageVariants.length === 0 && form.pageVariant === "")}
            value={form.pageVariant}
            onchange={(e) => (form.pageVariant = pickSelectValue(e))}
          >
            <option value="">{pageEffort.first}</option>
            {#each pageEffort.list as v (v)}<option value={v}>{v}</option>{/each}
          </select>
        </label>

        <div class="block">
          <span class="lbl">{tr("opt.tpl.selectionModel")}</span>
          <ModelSelect
            {models}
            loading={modelsLoading}
            value={form.selectionModel}
            label={tr("opt.tpl.selectionModel")}
            inheritLabel={inheritWith(modelLabel(globals.selectionModel))}
            onchange={(m) => setModel("selection", m)}
          />
        </div>

        <label class="block">
          <span class="lbl">{tr("opt.tpl.selectionEffort")}</span>
          <select
            class="fld"
            class:inh={form.selectionVariant === ""}
            disabled={!form.selectionModel || (selectionVariants.length === 0 && form.selectionVariant === "")}
            value={form.selectionVariant}
            onchange={(e) => (form.selectionVariant = pickSelectValue(e))}
          >
            <option value="">{selectionEffort.first}</option>
            {#each selectionEffort.list as v (v)}<option value={v}>{v}</option>{/each}
          </select>
        </label>
      </div>

      <div class="actions">
        <button type="button" class="btn pri" disabled={!dirty || nameMissing} onclick={save}>
          {tr("opt.tpl.save")}
        </button>
        <button type="button" class="btn" onclick={duplicate}>{tr("opt.tpl.duplicate")}</button>
        <button type="button" class="btn" disabled={isDefault} onclick={() => onsetdefault(selected.id)}>
          {isDefault ? tr("opt.tpl.isDefault") : tr("opt.tpl.makeDefault")}
        </button>
        <span class="spacer"></span>
        {#if selected.builtin}
          <button type="button" class="btn dng" onclick={reset}>{tr("opt.tpl.resetOriginal")}</button>
        {:else}
          <button type="button" class="btn dng" onclick={remove}>{tr("opt.tpl.delete")}</button>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .tpl {
    margin-top: 16px;
    display: flex;
    flex-wrap: wrap;
    gap: 24px;
    align-items: flex-start;
  }
  .list {
    flex: 0 0 240px;
    max-width: 100%;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .items {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .empty {
    padding: 8px 10px;
  }
  .pl {
    font: inherit;
    font-size: 13px;
    text-align: left;
    width: 100%;
    padding: 8px 10px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: none;
    color: var(--tx);
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
  }
  .pl.on {
    background: var(--sf);
    border-color: var(--bd2);
    font-weight: 600;
  }
  .pl:focus-visible {
    outline: 2px solid var(--ac);
    outline-offset: 2px;
  }
  .tag {
    font-size: 11px;
    color: var(--mu);
    font-weight: 400;
  }
  .editor {
    flex: 999 1 380px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .block {
    display: block;
  }
  .hint {
    display: block;
    margin-top: 6px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr));
    gap: 12px 16px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .spacer {
    flex: 1 1 0;
  }
</style>
