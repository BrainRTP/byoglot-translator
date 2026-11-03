<script lang="ts">
  import type { ModelInfo } from "../opencode/types";
  import { groupByProvider, type ModelId, modelKey } from "./options-logic";

  let {
    models,
    value,
    label,
    inheritLabel,
    onchange,
  }: {
    models: ModelInfo[];
    value: ModelId | null;
    label: string;
    inheritLabel?: string;
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

<select
  class="fld"
  class:inh={inheritLabel !== undefined && !value}
  aria-label={label}
  value={value ? modelKey(value) : ""}
  onchange={pick}
>
  {#if inheritLabel !== undefined}
    <option value="">{inheritLabel}</option>
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
