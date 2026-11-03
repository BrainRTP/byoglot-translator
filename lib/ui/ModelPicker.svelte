<script lang="ts">
  import type { ModelInfo, ModelRef } from "../opencode/types";
  import { tr } from "./i18n.svelte";
  import { variantFor } from "./popup-logic";

  let {
    models,
    value,
    onchange,
  }: {
    models: ModelInfo[];
    value: ModelRef | null;
    onchange: (model: ModelRef) => void;
  } = $props();

  let select: HTMLSelectElement | undefined = $state();

  export function focus() {
    select?.focus();
  }

  const key = (m: { providerID: string; id: string }) => `${m.providerID}/${m.id}`;

  const groups = $derived.by(() => {
    const byProvider = new Map<string, ModelInfo[]>();
    for (const m of models) byProvider.set(m.providerID, [...(byProvider.get(m.providerID) ?? []), m]);
    return [...byProvider.entries()];
  });

  const current = $derived(
    value ? models.find((m) => m.providerID === value.providerID && m.id === value.id) : undefined,
  );
  const variants = $derived(current?.variants ?? []);

  function pickModel(event: Event) {
    const chosen = models.find((m) => key(m) === (event.currentTarget as HTMLSelectElement).value);
    if (!chosen) return;
    const variant = variantFor(chosen, value?.variant);
    onchange({
      providerID: chosen.providerID,
      id: chosen.id,
      ...(variant !== undefined && { variant }),
    });
  }

  function pickVariant(event: Event) {
    if (!value) return;
    const raw = (event.currentTarget as HTMLSelectElement).value;
    const { variant: _drop, ...rest } = value;
    onchange(raw === "" ? rest : { ...rest, variant: raw });
  }
</script>

<div class="row">
  <div class="cell">
    <div class="lbl">{tr("popup.model")}</div>
    <select
      class="sel"
      bind:this={select}
      aria-label={tr("popup.model")}
      value={value ? key(value) : ""}
      onchange={pickModel}
    >
      {#if value && !current}
        <option value={key(value)}>{value.id}</option>
      {/if}
      {#each groups as [provider, list] (provider)}
        <optgroup label={provider}>
          {#each list as m (key(m))}
            <option value={key(m)}>{m.name || m.id}</option>
          {/each}
        </optgroup>
      {/each}
    </select>
  </div>
  <div class="cell">
    <div class="lbl">{tr("popup.effort")}</div>
    <select
      class="sel"
      aria-label={tr("popup.effort")}
      disabled={variants.length === 0}
      value={value?.variant ?? ""}
      onchange={pickVariant}
    >
      {#if variants.length === 0}
        <option value={value?.variant ?? ""}>{value?.variant ?? "-"}</option>
      {:else}
        {#if value?.variant === undefined}
          <option value="">{tr("popup.modelDefault")}</option>
        {/if}
        {#each variants as v (v)}
          <option value={v}>{v}</option>
        {/each}
      {/if}
    </select>
  </div>
</div>

<style>
  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) var(--side-col, 104px);
    gap: 8px;
  }
  .cell {
    min-width: 0;
  }
</style>
