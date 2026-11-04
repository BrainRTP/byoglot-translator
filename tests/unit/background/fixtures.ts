import type { ConnectionRecord } from "../../../lib/connections/types";
import type { Connection } from "../../../lib/opencode/types";
import { connectionsStore } from "../../../lib/settings/store";

export const OPENCODE_ID = "oc1";

export async function seedOpencode(conn: Connection | null): Promise<void> {
  if (!conn) {
    await connectionsStore.setAll([]);
    await connectionsStore.setActiveId(null);
    return;
  }
  const record: ConnectionRecord = {
    kind: "opencode",
    id: OPENCODE_ID,
    ...conn,
    pageModel: null,
    selectionModel: null,
  };
  await connectionsStore.setAll([record]);
  await connectionsStore.setActiveId(OPENCODE_ID);
}

export async function storedOpencode(): Promise<Connection | null> {
  const active = await connectionsStore.getActive();
  if (active?.kind !== "opencode") return null;
  return { url: active.url, username: active.username, password: active.password };
}
