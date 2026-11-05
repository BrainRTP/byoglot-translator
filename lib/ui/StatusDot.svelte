<script lang="ts">
  let { tone }: { tone: "ok" | "er" | "wait" } = $props();
</script>

<span class="dot {tone}" aria-hidden="true"></span>

<style>
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex: none;
    display: inline-block;
  }
  .ok {
    background: var(--ok);
  }
  .er {
    background: var(--er);
  }
  .wait {
    background: var(--mu);
  }
</style>
