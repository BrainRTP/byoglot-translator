<script lang="ts">
  import { onMount } from "svelte";
  import { createAnimator } from "../dom/effects/animator";
  import type { AnimationKind } from "../dom/effects/types";
  import { createDemo, createHoverLoop, type HoverLoop, REST_LANG } from "./animation-demo";
  import { PREVIEW } from "./animation-samples";
  import { tr } from "./i18n.svelte";

  let {
    kind,
    selected,
    tabindex,
    reduced,
    onpick,
    onkeydown,
  }: {
    kind: AnimationKind;
    selected: boolean;
    tabindex: 0 | -1;
    reduced: boolean;
    onpick: () => void;
    onkeydown: (e: KeyboardEvent) => void;
  } = $props();

  let preview: HTMLElement | undefined = $state();
  let loop: HoverLoop | null = null;
  let hover = false;
  let focus = false;

  function sync() {
    if ((hover || focus) && !reduced) loop?.start();
    else loop?.stop();
  }

  onMount(() => {
    if (!preview) return;
    const animator = createAnimator({ win: window, quiet: (fn) => fn(), kind: () => kind });
    const demo = createDemo({ host: preview, sample: PREVIEW, animator });
    demo.settle(REST_LANG, "replace");
    loop = createHoverLoop(demo);
    return () => {
      loop?.stop();
      demo.destroy();
      loop = null;
    };
  });

  $effect(() => {
    void reduced;
    sync();
  });
</script>

<!-- biome-ignore lint/a11y/useSemanticElements: a card with a live preview inside cannot be a native radio input -->
<button
  type="button"
  class="card"
  class:picked={selected}
  role="radio"
  aria-checked={selected}
  {tabindex}
  data-kind={kind}
  onclick={onpick}
  {onkeydown}
  onmouseenter={() => {
    hover = true;
    sync();
  }}
  onmouseleave={() => {
    hover = false;
    sync();
  }}
  onfocus={(e) => {
    focus = e.currentTarget.matches(":focus-visible");
    sync();
  }}
  onblur={() => {
    focus = false;
    sync();
  }}
>
  <span class="pv" bind:this={preview} aria-hidden="true"></span>
  <span class="nm">{tr(`anim.${kind}`)}</span>
  <span class="ds">{tr(`anim.${kind}.desc`)}</span>
  {#if selected}
    <span class="tick" aria-hidden="true">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M5 12l5 5 9-10" />
      </svg>
    </span>
  {/if}
</button>

<style>
  .card {
    font: inherit;
    color: var(--tx);
    text-align: left;
    background: var(--bg);
    border: 1px solid var(--bd);
    border-radius: 8px;
    padding: 8px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 6px;
    position: relative;
    min-width: 0;
  }
  .card.picked {
    border: 2px solid var(--ac);
    padding: 7px;
  }
  .card:focus-visible {
    outline: 2px solid var(--ac);
    outline-offset: 2px;
  }
  .pv {
    display: block;
    height: 76px;
    padding: 10px;
    border-radius: 6px;
    background: var(--sf);
    overflow: hidden;
  }
  .pv :global(.l-h) {
    display: block;
    font-size: 12px;
    line-height: 16px;
    font-weight: 600;
  }
  .pv :global(.l-p) {
    display: block;
    margin-top: 3px;
    font-size: 11px;
    line-height: 15px;
    text-wrap: balance;
  }
  .nm {
    display: block;
    font-weight: 600;
    font-size: 13px;
    padding: 0 2px;
  }
  .ds {
    display: block;
    font-size: 12px;
    line-height: 17px;
    color: var(--mu);
    padding: 0 2px 2px;
  }
  .tick {
    position: absolute;
    top: 14px;
    right: 14px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--ac);
    color: var(--acf);
    display: flex;
    align-items: center;
    justify-content: center;
  }
</style>
