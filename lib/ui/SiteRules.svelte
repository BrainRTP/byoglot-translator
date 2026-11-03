<script lang="ts">
  import type { RuleOp } from "../messaging/protocol";
  import type { SiteRule, Template } from "../settings/types";
  import { tr } from "./i18n.svelte";
  import { type RuleError, ruleError } from "./options-logic";

  let {
    rules,
    templates,
    defaultTemplateId,
    onop,
  }: {
    rules: SiteRule[];
    templates: Template[];
    defaultTemplateId: string;
    onop: (op: RuleOp) => Promise<boolean>;
  } = $props();

  let editingId = $state<string | null>(null);
  let editPattern = $state("");
  let editTemplateId = $state("");
  let newPattern = $state("");
  let newTemplateId = $state("");

  const nameOf = (t: Template) => (t.builtin ? tr("template.builtin") : t.name);
  const templateName = (id: string) => {
    const t = templates.find((x) => x.id === id);
    return t ? nameOf(t) : "-";
  };

  const addError = $derived(ruleError(newPattern, rules));
  const editError = $derived(editingId ? ruleError(editPattern, rules, editingId) : null);
  const addTemplate = $derived(
    templates.some((t) => t.id === newTemplateId) ? newTemplateId : defaultTemplateId,
  );

  const message = (e: RuleError | null) =>
    e === "invalid" ? tr("opt.rules.invalid") : e === "duplicate" ? tr("opt.rules.duplicate") : "";

  function startEdit(rule: SiteRule) {
    editingId = rule.id;
    editPattern = rule.pattern;
    editTemplateId = rule.templateId;
  }

  async function saveEdit() {
    if (!editingId || editError) return;
    const ok = await onop({
      type: "upsert",
      rule: { id: editingId, pattern: editPattern.trim().toLowerCase(), templateId: editTemplateId },
    });
    if (ok) editingId = null;
  }

  async function add() {
    if (addError) return;
    const ok = await onop({
      type: "upsert",
      rule: {
        id: crypto.randomUUID(),
        pattern: newPattern.trim().toLowerCase(),
        templateId: addTemplate,
      },
    });
    if (ok) newPattern = "";
  }
</script>

<div class="tbl">
  <div class="rrow hd">
    <div class="c1">{tr("opt.rules.mask")}</div>
    <div class="c2">{tr("opt.rules.template")}</div>
    <div class="c3"></div>
  </div>
  {#each rules as rule (rule.id)}
    <div class="rrow">
      {#if editingId === rule.id}
        <div class="c1">
          <input
            class="fld mono"
            type="text"
            aria-label={tr("opt.rules.mask")}
            aria-invalid={editError !== null}
            bind:value={editPattern}
            onkeydown={(e) => {
              if (e.key === "Enter") void saveEdit();
              if (e.key === "Escape") editingId = null;
            }}
          />
          {#if message(editError)}<div class="err">{message(editError)}</div>{/if}
        </div>
        <div class="c2">
          <select class="fld" aria-label={tr("opt.rules.template")} bind:value={editTemplateId}>
            {#each templates as t (t.id)}<option value={t.id}>{nameOf(t)}</option>{/each}
          </select>
        </div>
        <div class="c3 btns">
          <button type="button" class="btn sm pri" disabled={editError !== null} onclick={saveEdit}>
            {tr("opt.rules.save")}
          </button>
          <button type="button" class="btn sm" onclick={() => (editingId = null)}>
            {tr("common.cancel")}
          </button>
        </div>
      {:else}
        <div class="c1 mono">{rule.pattern}</div>
        <div class="c2">{templateName(rule.templateId)}</div>
        <div class="c3 btns">
          <button type="button" class="btn sm" onclick={() => startEdit(rule)}>
            {tr("opt.rules.edit")}
          </button>
          <button type="button" class="btn sm dng" onclick={() => onop({ type: "delete", id: rule.id })}>
            {tr("opt.rules.delete")}
          </button>
        </div>
      {/if}
    </div>
  {:else}
    <div class="rrow mu">{tr("opt.rules.empty")}</div>
  {/each}
</div>

<div class="add">
  <div class="addpat">
    <input
      class="fld mono"
      type="text"
      placeholder={tr("opt.rules.placeholder")}
      aria-label={tr("opt.rules.mask")}
      aria-invalid={addError === "invalid" || addError === "duplicate"}
      bind:value={newPattern}
      onkeydown={(e) => e.key === "Enter" && add()}
    />
  </div>
  <select
    class="fld addtpl"
    aria-label={tr("opt.rules.template")}
    value={addTemplate}
    onchange={(e) => (newTemplateId = e.currentTarget.value)}
  >
    {#each templates as t (t.id)}<option value={t.id}>{nameOf(t)}</option>{/each}
  </select>
  <button type="button" class="btn" disabled={addError !== null} onclick={add}>
    {tr("opt.rules.add")}
  </button>
  {#if message(addError)}<div class="err full">{message(addError)}</div>{/if}
</div>

<div class="note precedence">{tr("opt.rules.precedence")}</div>

<style>
  .tbl {
    margin-top: 16px;
    border: 1px solid var(--bd);
    border-radius: 8px;
  }
  .rrow {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 16px;
    padding: 10px 16px;
  }
  .rrow + .rrow {
    border-top: 1px solid var(--bd);
  }
  .hd {
    color: var(--mu);
    font-size: 12px;
    background: var(--sf);
    border-radius: 8px 8px 0 0;
  }
  .c1 {
    flex: 1 1 180px;
    min-width: 0;
  }
  .c2 {
    flex: 1 1 160px;
    min-width: 0;
  }
  .c3 {
    flex: 0 1 190px;
  }
  .btns {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .add {
    margin-top: 12px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .addpat {
    flex: 1 1 200px;
    min-width: 0;
  }
  .addtpl {
    flex: 1 1 160px;
    width: auto;
  }
  .full {
    flex: 1 0 100%;
    margin-top: -2px;
  }
  .precedence {
    margin-top: 12px;
  }
</style>
