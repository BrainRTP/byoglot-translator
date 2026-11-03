<script lang="ts">
  import { onMount } from "svelte";
  import { createAnimator } from "../dom/effects/animator";
  import type { AnimationKind } from "../dom/effects/types";
  import { createDemo, createStage, type DemoMode, type Stage } from "./animation-demo";
  import { SCENE } from "./animation-samples";
  import { tr } from "./i18n.svelte";
  import Segmented from "./Segmented.svelte";

  let { kind, reduced }: { kind: AnimationKind; reduced: boolean } = $props();

  let scene: HTMLElement | undefined = $state();
  let stage: Stage | null = null;
  let mode = $state<DemoMode>("replace");

  const modes = $derived<{ value: DemoMode; label: string }[]>([
    { value: "replace", label: tr("popup.modeReplace") },
    { value: "bilingual", label: tr("popup.modeBilingual") },
  ]);

  export function play() {
    stage?.play();
  }

  function pickMode(next: DemoMode) {
    mode = next;
    stage?.setMode(next);
  }

  onMount(() => {
    if (!scene) return;
    const animator = createAnimator({ win: window, quiet: (fn) => fn(), kind: () => kind });
    const demo = createDemo({ host: scene, sample: SCENE, animator });
    stage = createStage(demo);
    return () => {
      demo.destroy();
      stage = null;
    };
  });

  $effect(() => {
    if (reduced) stage?.settle();
  });
</script>

<div class="bar">
  <Segmented value={mode} options={modes} label={tr("opt.anim.mode")} size="fit" onchange={pickMode} />
  <button type="button" class="btn" onclick={play}>{tr("opt.anim.repeat")}</button>
</div>
<article class="scene" aria-label={tr("opt.anim.scene")} bind:this={scene}></article>

<style>
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .scene {
    border: 1px solid var(--bd);
    border-radius: 8px;
    padding: 24px 28px;
    min-height: 250px;
    overflow: hidden;
  }
  .scene :global(h3) {
    margin: 0;
    font-size: 20px;
    line-height: 28px;
    font-weight: 600;
  }
  .scene :global(p),
  .scene :global(li) {
    font-size: 14px;
    line-height: 22px;
  }
  .scene :global(p) {
    margin: 12px 0 0;
    max-width: 460px;
  }
  .scene :global(ul) {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .scene :global(li) {
    margin: 12px 0 0;
    padding-left: 18px;
    position: relative;
  }
  .scene :global(li)::before {
    content: "\2022";
    position: absolute;
    left: 4px;
    color: var(--mu);
  }
  .scene :global(a) {
    color: var(--ac);
    text-decoration: underline;
  }
  .scene:global([data-mode="bilingual"]) :global(h3),
  .scene:global([data-mode="bilingual"]) :global(p),
  .scene:global([data-mode="bilingual"]) :global(li) {
    color: var(--mu);
  }
  .scene :global([data-byoglot]) {
    margin-top: 6px;
    color: var(--tx);
  }
</style>
