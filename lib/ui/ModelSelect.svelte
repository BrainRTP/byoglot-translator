<script lang="ts">
  import type { ModelInfo } from "../opencode/types";
  import { tr } from "./i18n.svelte";
  import { groupByProvider, type ModelId, modelKey } from "./options-logic";

  let {
    models,
    value,
    label,
    inheritLabel,
    loading = false,
    onchange,
  }: {
    models: ModelInfo[];
    value: ModelId | null;
    label: string;
    inheritLabel?: string;
    loading?: boolean;
    onchange: (model: ModelId | null) => void;
  } = $props();

  const groups = $derived(groupByProvider(models));
  const known = $derived(!value || models.some((m) => modelKey(m) === modelKey(value)));

  function pick(event: Event) {
    const raw = (event.currentTarget as HTMLSelectElement).value;
    const chosen = models.find((m) => modelKey(m) === raw);
    onchange(chosen ? { providerID: chosen.providerID, id: chosen.id } : null);
  }
</script>

<div class="ms" class:loading aria-busy={loading}>
<select
  class="fld"
  class:inh={inheritLabel !== undefined && !value}
  aria-label={label}
  disabled={loading}
  value={value ? modelKey(value) : ""}
  onchange={pick}
>
  {#if inheritLabel !== undefined}
    <option value="">{inheritLabel}</option>
  {:else if !value}
    <option value="" disabled>{tr("models.choose")}</option>
  {/if}
  {#if value && !known}
    <option value={modelKey(value)}>{value.id}</option>
  {/if}
  {#each groups as [provider, list] (provider)}
    <optgroup label={provider}>
      {#each list as m (modelKey(m))}
        <option value={modelKey(m)}>{m.name || m.id}</option>
      {/each}
    </optgroup>
  {/each}
</select>
{#if loading}<span class="spin"></span>{/if}
</div>

<style>
  .ms {
    position: relative;
  }
  .loading select {
    filter: blur(1.5px);
    opacity: 0.6;
  }
  .ms .spin {
    position: absolute;
    top: 50%;
    left: 50%;
    margin: -7px 0 0 -7px;
    pointer-events: none;
  }
</style>
