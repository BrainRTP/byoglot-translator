<script lang="ts" generics="V extends string">
  type Option = { value: V; label: string };
  let {
    value,
    options,
    label,
    size = "md",
    onchange,
  }: {
    value: V;
    options: Option[];
    label: string;
    size?: "md" | "sm";
    onchange: (value: V) => void;
  } = $props();
</script>

<!-- biome-ignore lint/a11y/useSemanticElements: a fieldset would need resets for the pill look -->
<div class="seg {size}" role="group" aria-label={label}>
  {#each options as option (option.value)}
    <button
      type="button"
      class:on={option.value === value}
      aria-pressed={option.value === value}
      onclick={() => onchange(option.value)}
    >
      {option.label}
    </button>
  {/each}
</div>

<style>
  .seg {
    display: flex;
    border: 1px solid var(--bd2);
    border-radius: 6px;
    padding: 2px;
    gap: 2px;
  }
  button {
    font: inherit;
    border: 0;
    border-radius: 4px;
    background: none;
    color: var(--tx);
    cursor: pointer;
  }
  button.on {
    background: var(--tx);
    color: var(--bg);
    font-weight: 600;
  }
  button:focus-visible {
    outline: 2px solid var(--ac);
    outline-offset: 2px;
  }
  .md button {
    flex: 1;
    min-width: 0;
    min-height: 30px;
    padding: 0 4px;
  }
  .sm button {
    font-size: 12px;
    min-width: 44px;
    min-height: 28px;
  }
</style>
