<script lang="ts">
  import type { ConnectionView } from "../connections/types";
  import type { Status } from "../messaging/protocol";
  import { tr } from "./i18n.svelte";
  import { errorView } from "./popup-logic";
  import StatusDot from "./StatusDot.svelte";

  let {
    connections,
    status,
    busyId = null,
    onuse,
    onedit,
    onremove,
  }: {
    connections: ConnectionView[];
    status: Status | null;
    busyId?: string | null;
    onuse: (id: string) => void;
    onedit: (view: ConnectionView) => void;
    onremove: (view: ConnectionView) => void;
  } = $props();

  const failure = $derived(
    status?.state === "error"
      ? errorView(status.kind, status.retryAfterMs, Date.now(), status.backend)
      : null,
  );
</script>

<ul class="list">
  {#each connections as c (c.id)}
    <li class="row" class:on={c.active} data-connection={c.id}>
      <div class="info">
        <div class="head">
          {#if c.active}<StatusDot tone={failure ? "er" : "ok"} />{/if}
          <span class="name">{c.name}</span>
          {#if c.active}<span class="tag">{tr("conn.active")}</span>{/if}
        </div>
        <div class="mono mu url">{c.url}</div>
        {#if c.active && failure}
          <div class="fail" role="alert"><b>{failure.title}</b> {failure.body}</div>
        {/if}
      </div>
      <div class="btns">
        {#if !c.active}
          <button type="button" class="btn sm" disabled={busyId !== null} onclick={() => onuse(c.id)}>{tr("conn.use")}</button>
        {/if}
        {#if c.kind === "provider"}
          <button type="button" class="btn sm" disabled={busyId !== null} onclick={() => onedit(c)}>{tr("conn.edit")}</button>
        {/if}
        <button type="button" class="btn sm dng" disabled={busyId !== null} onclick={() => onremove(c)}>{tr("conn.remove")}</button>
      </div>
    </li>
  {/each}
</ul>

<style>
  .list {
    list-style: none;
    margin: 16px 0 0;
    padding: 0;
    border: 1px solid var(--bd);
    border-radius: 8px;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 16px;
    padding: 12px 16px;
  }
  .row + .row {
    border-top: 1px solid var(--bd);
  }
  .info {
    flex: 1 1 240px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .name {
    font-weight: 600;
  }
  .tag {
    font-size: 11px;
    color: var(--ok);
    border: 1px solid var(--ok);
    border-radius: 4px;
    padding: 0 6px;
  }
  .url {
    overflow-wrap: anywhere;
    font-size: 12px;
  }
  .fail {
    margin-top: 4px;
    color: var(--er);
    font-size: 12px;
  }
  .fail b {
    font-weight: 600;
  }
  .btns {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
</style>
