import type { ModelRef } from "../opencode/types";
import type { Template } from "../settings/types";
import type { ConnectionRecord, OpencodeData } from "./types";

export type LegacyGlobals = { pageModel?: ModelRef | null; selectionModel?: ModelRef | null };

export type Migrated = {
  connections: ConnectionRecord[];
  activeId: string | null;
  templates: Template[];
};

function stamp(ref: ModelRef | null | undefined, connectionId: string): ModelRef | null {
  return ref ? { ...ref, connectionId } : null;
}

export function migrateLegacy(
  legacy: OpencodeData | null,
  globals: LegacyGlobals,
  templates: Template[],
  newId: () => string,
): Migrated | null {
  if (!legacy) return null;
  const id = newId();
  const record: ConnectionRecord = {
    kind: "opencode",
    id,
    url: legacy.url,
    username: legacy.username,
    password: legacy.password,
    pageModel: stamp(globals.pageModel, id),
    selectionModel: stamp(globals.selectionModel, id),
  };
  const migrated = templates.map((t) => {
    const { pageModel, selectionModel } = t.settings;
    if (!pageModel && !selectionModel) return t;
    const settings = { ...t.settings };
    if (pageModel) settings.pageModel = { ...pageModel, connectionId: id };
    if (selectionModel) settings.selectionModel = { ...selectionModel, connectionId: id };
    return { ...t, settings };
  });
  return { connections: [record], activeId: id, templates: migrated };
}
