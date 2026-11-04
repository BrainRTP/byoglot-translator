import { storage } from "wxt/utils/storage";
import { migrateLegacy } from "../connections/migrate";
import type { ConnectionModels, ConnectionRecord, OpencodeData } from "../connections/types";
import type { ModelRef } from "../opencode/types";
import { builtinTemplate, DEFAULT_GLOBALS, initialGlobals } from "./defaults";
import type {
  EffectiveSettings,
  GlobalSettings,
  ProfileOverrides,
  SiteRule,
  Template,
} from "./types";

const rawLegacyConnection = storage.defineItem<OpencodeData | null>("local:connection", {
  fallback: null,
});

const rawConnections = storage.defineItem<ConnectionRecord[] | null>("local:connections", {
  fallback: null,
});

const rawActiveId = storage.defineItem<string | null>("local:activeConnectionId", {
  fallback: null,
});

type StoredGlobals = Omit<GlobalSettings, keyof ConnectionModels> & Partial<ConnectionModels>;

const rawGlobals = storage.defineItem<StoredGlobals>("local:globals", {
  fallback: initialGlobals(globalThis.navigator?.language),
});

const rawTemplates = storage.defineItem<Template[]>("local:templates", {
  fallback: [builtinTemplate()],
});

function withoutModels(stored: StoredGlobals): StoredGlobals {
  const { pageModel: _page, selectionModel: _selection, ...rest } = stored;
  return rest;
}

async function migrateOnce(): Promise<void> {
  if ((await rawConnections.getValue()) !== null) return;
  const legacy = await rawLegacyConnection.getValue();
  if (!legacy) return;
  const stored = await rawGlobals.getValue();
  const migrated = migrateLegacy(legacy, stored, await rawTemplates.getValue(), () =>
    crypto.randomUUID(),
  );
  if (!migrated) return;
  await rawTemplates.setValue(migrated.templates);
  await rawGlobals.setValue(withoutModels(stored));
  await rawActiveId.setValue(migrated.activeId);
  await rawConnections.setValue(migrated.connections);
  await rawLegacyConnection.removeValue();
}

let migration: Promise<void> | null = null;

function migrate(): Promise<void> {
  migration ??= migrateOnce().finally(() => {
    migration = null;
  });
  return migration;
}

export const connectionsStore = {
  async getAll(): Promise<ConnectionRecord[]> {
    await migrate();
    return (await rawConnections.getValue()) ?? [];
  },
  async setAll(list: ConnectionRecord[]): Promise<void> {
    await migrate();
    await rawConnections.setValue(list);
  },
  async getActiveId(): Promise<string | null> {
    await migrate();
    return rawActiveId.getValue();
  },
  async setActiveId(id: string | null): Promise<void> {
    await migrate();
    await rawActiveId.setValue(id);
  },
  async getActive(): Promise<ConnectionRecord | null> {
    const [list, activeId] = await Promise.all([this.getAll(), this.getActiveId()]);
    return list.find((rec) => rec.id === activeId) ?? null;
  },
};

function stampRef(ref: ModelRef | null, connectionId: string): ModelRef | null {
  return ref ? { ...ref, connectionId: ref.connectionId ?? connectionId } : null;
}

// The two model fields live in the active connection record; everything else stays in globals.
export const globalsItem = {
  async getValue(): Promise<GlobalSettings> {
    const active = await connectionsStore.getActive();
    return {
      ...DEFAULT_GLOBALS,
      ...(await rawGlobals.getValue()),
      pageModel: active?.pageModel ?? null,
      selectionModel: active?.selectionModel ?? null,
    };
  },
  async setValue(value: GlobalSettings): Promise<void> {
    const { pageModel, selectionModel, ...rest } = value;
    const [list, activeId] = await Promise.all([
      connectionsStore.getAll(),
      connectionsStore.getActiveId(),
    ]);
    const index = list.findIndex((rec) => rec.id === activeId);
    const active = list[index];
    if (active) {
      const next = [...list];
      next[index] = {
        ...active,
        pageModel: stampRef(pageModel, active.id),
        selectionModel: stampRef(selectionModel, active.id),
      };
      await rawConnections.setValue(next);
    }
    await rawGlobals.setValue(rest);
  },
};

export const templatesItem = rawTemplates;

export const siteRulesItem = storage.defineItem<SiteRule[]>("local:siteRules", {
  fallback: [],
});

export const profileOverridesItem = storage.defineItem<ProfileOverrides>("local:languageProfiles", {
  fallback: {},
});

export function tabSettings(tabId: number) {
  return storage.defineItem<EffectiveSettings | null>(`session:tab-${tabId}`, { fallback: null });
}

export function tabHostItem(tabId: number) {
  return storage.defineItem<string | null>(`session:tabhost-${tabId}`, { fallback: null });
}
