import type { Connection } from "../opencode/types";
import { connectionsStore } from "../settings/store";

// Opencode-only view over the connection list, until the handlers learn about providers.
export const opencodeConnection = {
  async getValue(): Promise<Connection | null> {
    const active = await connectionsStore.getActive();
    if (active?.kind !== "opencode") return null;
    return { url: active.url, username: active.username, password: active.password };
  },
  async setValue(conn: Connection | null): Promise<void> {
    const [list, activeId] = await Promise.all([
      connectionsStore.getAll(),
      connectionsStore.getActiveId(),
    ]);
    if (!conn) {
      await connectionsStore.setAll(
        list.filter((rec) => rec.id !== activeId || rec.kind !== "opencode"),
      );
      await connectionsStore.setActiveId(null);
      return;
    }
    const existing =
      list.find((rec) => rec.id === activeId && rec.kind === "opencode") ??
      list.find((rec) => rec.kind === "opencode");
    const record = {
      pageModel: null,
      selectionModel: null,
      ...existing,
      ...conn,
      kind: "opencode" as const,
      id: existing?.id ?? crypto.randomUUID(),
    };
    await connectionsStore.setAll([...list.filter((rec) => rec.id !== record.id), record]);
    await connectionsStore.setActiveId(record.id);
  },
};
