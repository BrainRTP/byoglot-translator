<script lang="ts">
  import { tick } from "svelte";
  import { availableKinds } from "../dom/effects/registry";
  import type { AnimationKind } from "../dom/effects/types";
  import AnimationCard from "./AnimationCard.svelte";
  import AnimationStage from "./AnimationStage.svelte";
  import { radioMove, tabbableKind } from "./animation-logic";
  import { tr } from "./i18n.svelte";

  let { value, onpick }: { value: AnimationKind; onpick: (kind: AnimationKind) => void } = $props();

  const kinds = availableKinds();
  const tabbable = $derived(tabbableKind(kinds, value));

  let group: HTMLElement | undefined = $state();
  let stage: ReturnType<typeof AnimationStage> | undefined = $state();
  let reduced = $state(false);

  $effect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    reduced = query.matches;
    const update = () => (reduced = query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  });

  async function pick(kind: AnimationKind) {
    if (kind !== value) onpick(kind);
    await tick();
    if (!reduced) stage?.play();
  }

  function onkeydown(e: KeyboardEvent, kind: AnimationKind) {
    const next = radioMove(kinds, kind, e.key);
    if (!next) return;
    e.preventDefault();
    void pick(next);
    group?.querySelector<HTMLElement>(`[data-kind="${next}"]`)?.focus();
  }
</script>

<div class="anim">
  {#if reduced}
    <div class="warn" role="note">{tr("opt.anim.reduced")}</div>
  {/if}
  <div class="grid" role="radiogroup" aria-label={tr("opt.anim.group")} bind:this={group}>
    {#each kinds as kind (kind)}
      <AnimationCard
        {kind}
        selected={kind === value}
        tabindex={kind === tabbable ? 0 : -1}
        {reduced}
        onpick={() => pick(kind)}
        onkeydown={(e) => onkeydown(e, kind)}
      />
    {/each}
  </div>
  <AnimationStage bind:this={stage} kind={value} {reduced} />
</div>

<style>
  .anim {
    margin-top: 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .warn {
    background: var(--wns);
    border: 1px solid var(--wn);
    border-radius: 6px;
    padding: 10px 12px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 12px;
  }
</style>
