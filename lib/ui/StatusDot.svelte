<script lang="ts">
  let { tone }: { tone: "ok" | "er" } = $props();
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
</style>
