import { browser } from "wxt/browser";
import type { TranslationCache } from "../cache/cache";
import type {
  LanguageProfileView,
  PageState,
  ProfileOp,
  ProtocolMap,
  ResolvedModel,
  SelectionResult,
  Status,
  TabView,
  TemplateOp,
} from "../messaging/protocol";
import { BackendError } from "../opencode/errors";
import { parsePairingLink } from "../opencode/pairing";
import type { Connection, ModelInfo, ModelRef, TranslationBackend } from "../opencode/types";
import { BUILTIN_TEMPLATE_ID, builtinTemplate } from "../settings/defaults";
import {
  applyTemplate,
  isModified,
  ownModel,
  pickInitialModels,
  resolveModel,
} from "../settings/effective";
import {
  isProfileModified,
  isProfileOutdated,
  languagePromptText,
  MAX_PROFILE_TEXT,
  profileText,
} from "../settings/language-prompt";
import { isValidPattern, matchSiteRule } from "../settings/site-rules";
import {
  connectionsStore,
  globalsItem,
  profileOverridesItem,
  siteRulesItem,
  tabHostItem,
  tabSettings,
  templatesItem,
} from "../settings/store";
import {
  createTemplate,
  deleteTemplate,
  duplicateTemplate,
  resetBuiltin,
  updateTemplate,
} from "../settings/templates";
import type {
  EffectiveSettings,
  GlobalSettings,
  ProfileOverride,
  ProfileOverrides,
  SiteRule,
  Template,
} from "../settings/types";
import { BUILTIN_PROFILES, PROFILE_IDS } from "../translate/profiles";
import type { createTranslationService, PageJob, Segment } from "../translate/service";
import { opencodeConnection } from "./opencode-connection";

export interface HandlerDeps {
  getBackend(): Promise<TranslationBackend>;
  createBackend(conn: Connection): TranslationBackend;
  pair(link: string): Promise<Connection>;
  service: Pick<ReturnType<typeof createTranslationService>, "translateSelection">;
  cache: TranslationCache;
}

export type Sender = {
  id?: string;
  url?: string;
  frameId?: number;
  tab?: { id?: number; url?: string };
};

export function hostnameOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export function toBackendError(error: unknown): BackendError {
  if (error instanceof BackendError) return error;
  return new BackendError("incompatible", {
    detail: error instanceof Error ? error.message : String(error),
    cause: error,
  });
}

export function resolveStoredModel(
  ref: ModelRef | null,
  models: ModelInfo[] | null,
  fallback: ModelRef | null,
  activeId: string | null,
): ResolvedModel {
  if (ref && !ownModel(ref, activeId)) return { model: fallback, missing: false };
  if (!models) return { model: ref ?? fallback, missing: false };
  const resolved = resolveModel(ref, models, fallback);
  if (!ref || resolved.missing) return resolved;
  const info = models.find((m) => m.providerID === ref.providerID && m.id === ref.id);
  if (ref.variant !== undefined && info && !info.variants.includes(ref.variant)) {
    return { model: { ...ref, variant: undefined }, missing: true };
  }
  return resolved;
}

const MODELS_TTL_MS = 30_000;
const BADGE_TEXT: Record<PageState["state"], string> = {
  idle: "",
  translating: "...",
  translated: "",
  error: "!",
};
const BADGE_ERROR_COLOR = "#d93025";

export function createHandlers(deps: HandlerDeps) {
  let modelsCache: { at: number; models: ModelInfo[] } | null = null;
  const selectionJobs = new Map<string, { controller: AbortController; tabId?: number }>();

  async function fetchModels(): Promise<ModelInfo[]> {
    const models = await (await deps.getBackend()).listModels();
    modelsCache = { at: Date.now(), models };
    return models;
  }

  async function loadModels(): Promise<ModelInfo[] | null> {
    if (modelsCache && Date.now() - modelsCache.at < MODELS_TTL_MS) return modelsCache.models;
    try {
      return await fetchModels();
    } catch {
      return null;
    }
  }

  async function rememberHost(tabId: number, hostname: string): Promise<void> {
    if (hostname) await tabHostItem(tabId).setValue(hostname);
  }

  async function tabHostname(tabId: number): Promise<string> {
    try {
      return hostnameOf((await browser.tabs.get(tabId)).url);
    } catch {
      return "";
    }
  }

  async function resolveView(
    tabId: number | undefined,
    hostname: string,
    templateOverride?: string,
  ): Promise<TabView> {
    const [g, templates, rules, activeId] = await Promise.all([
      globalsItem.getValue(),
      templatesItem.getValue(),
      siteRulesItem.getValue(),
      connectionsStore.getActiveId(),
    ]);
    const byId = (id: string) => templates.find((t) => t.id === id);
    const defaultTemplate =
      byId(g.defaultTemplateId) ?? byId(BUILTIN_TEMPLATE_ID) ?? builtinTemplate();
    const rule = matchSiteRule(hostname, rules);
    let stored = tabId === undefined ? null : await tabSettings(tabId).getValue();
    if (stored && tabId !== undefined && hostname) {
      const storedHost = await tabHostItem(tabId).getValue();
      if (storedHost !== null && storedHost !== hostname) {
        await tabSettings(tabId).removeValue();
        stored = null;
      }
    }
    const override =
      templateOverride === undefined || stored?.templateId === templateOverride
        ? undefined
        : byId(templateOverride);

    let template: Template;
    let settings: EffectiveSettings;
    if (override) {
      template = override;
      settings = applyTemplate(override, g, activeId);
    } else if (stored) {
      template = byId(stored.templateId) ?? defaultTemplate;
      settings = stored;
    } else {
      template = (rule && byId(rule.templateId)) ?? defaultTemplate;
      settings = applyTemplate(template, g, activeId);
    }

    const models = await loadModels();
    return {
      settings,
      animation: g.animation,
      template,
      modified: isModified(settings, template, g, activeId),
      rule,
      pageModel: resolveStoredModel(settings.pageModel, models, g.pageModel, activeId),
      selectionModel: resolveStoredModel(
        settings.selectionModel,
        models,
        g.selectionModel,
        activeId,
      ),
    };
  }

  function errorStatus(url: string, error: unknown): Status {
    const e = toBackendError(error);
    return { state: "error", url, kind: e.kind, retryAfterMs: e.retryAfterMs };
  }

  async function status(): Promise<Status> {
    const conn = await opencodeConnection.getValue();
    if (!conn) return { state: "disconnected" };
    try {
      const info = await (await deps.getBackend()).info();
      return { state: "connected", url: conn.url, version: info.version };
    } catch (error) {
      return errorStatus(conn.url, error);
    }
  }

  async function initModels(): Promise<void> {
    if ((await globalsItem.getValue()).pageModel) return;
    try {
      const backend = await deps.getBackend();
      const [models, def] = await Promise.all([fetchModels(), backend.defaultModel()]);
      const activeId = await connectionsStore.getActiveId();
      if (!activeId) return;
      const picked = pickInitialModels(models, def, activeId);
      if (!picked.pageModel) return;
      const current = await globalsItem.getValue();
      if (current.pageModel) return;
      await globalsItem.setValue({ ...current, ...picked });
    } catch {}
  }

  async function requireModel(
    tabId: number | undefined,
    hostname: string,
    key: "pageModel" | "selectionModel",
    templateOverride?: string,
  ): Promise<{ view: TabView; model: ModelRef }> {
    if (!(await opencodeConnection.getValue())) throw new BackendError("unauthorized");
    let view = await resolveView(tabId, hostname, templateOverride);
    if (!view[key].model) {
      await initModels();
      view = await resolveView(tabId, hostname, templateOverride);
    }
    const model = view[key].model;
    if (!model) throw new BackendError("no_model");
    return { view, model };
  }

  async function saveConnection(conn: Connection): Promise<Status> {
    modelsCache = null;
    await opencodeConnection.setValue(conn);
    await initModels();
    return status();
  }

  async function templateOp(op: TemplateOp): Promise<Template[]> {
    const list = await templatesItem.getValue();
    switch (op.type) {
      case "create": {
        const next = createTemplate(list, op.name, op.settings).list;
        await templatesItem.setValue(next);
        return next;
      }
      case "update": {
        const next = updateTemplate(list, op.id, op.patch);
        await templatesItem.setValue(next);
        return next;
      }
      case "duplicate": {
        const next = duplicateTemplate(list, op.id, op.name).list;
        await templatesItem.setValue(next);
        return next;
      }
      case "delete": {
        const rules = await siteRulesItem.getValue();
        const next = deleteTemplate(list, rules, op.id);
        await templatesItem.setValue(next.list);
        await siteRulesItem.setValue(next.rules);
        const g = await globalsItem.getValue();
        if (g.defaultTemplateId === op.id) {
          await globalsItem.setValue({ ...g, defaultTemplateId: BUILTIN_TEMPLATE_ID });
        }
        return next.list;
      }
      case "resetBuiltin": {
        const next = resetBuiltin(list);
        await templatesItem.setValue(next);
        return next;
      }
    }
  }

  async function languagePromptFor(targetLang: string): Promise<string> {
    const [g, overrides] = await Promise.all([
      globalsItem.getValue(),
      profileOverridesItem.getValue(),
    ]);
    return languagePromptText(g, targetLang, BUILTIN_PROFILES, overrides);
  }

  function profileViews(overrides: ProfileOverrides): LanguageProfileView[] {
    return PROFILE_IDS.map((id) => {
      const builtin = BUILTIN_PROFILES.get(id) ?? "";
      const o = overrides[id];
      return {
        id,
        builtin,
        text: profileText(builtin, o),
        modified: isProfileModified(builtin, o),
        outdated: isProfileOutdated(builtin, o),
      };
    });
  }

  async function languageProfiles(): Promise<LanguageProfileView[]> {
    return profileViews(await profileOverridesItem.getValue());
  }

  async function languageProfileOp(op: ProfileOp): Promise<LanguageProfileView[]> {
    const builtin = BUILTIN_PROFILES.get(op.id);
    if (builtin === undefined) throw new Error(`Unknown language profile: ${op.id}`);
    const overrides = await profileOverridesItem.getValue();
    let entry: ProfileOverride | undefined;
    switch (op.type) {
      case "save":
        if (op.text.length > MAX_PROFILE_TEXT) {
          throw new Error(`Profile text is longer than ${MAX_PROFILE_TEXT} characters`);
        }
        entry = { text: op.text, base: builtin, savedAt: Date.now() };
        break;
      case "reset":
        entry = undefined;
        break;
      case "keep": {
        const current = overrides[op.id];
        entry = current && { ...current, base: builtin };
        break;
      }
    }
    if (!isProfileModified(builtin, entry)) entry = undefined;
    const rest = Object.fromEntries(Object.entries(overrides).filter(([id]) => id !== op.id));
    const next = entry ? { ...rest, [op.id]: entry } : rest;
    await profileOverridesItem.setValue(next);
    return profileViews(next);
  }

  const handlers = {
    status,

    async pair(link: string): Promise<Status> {
      try {
        return await saveConnection(await deps.pair(link));
      } catch (error) {
        let url = "";
        try {
          url = parsePairingLink(link).origin;
        } catch {}
        return errorStatus(url, error);
      }
    },

    async connectManual(conn: Connection): Promise<Status> {
      try {
        await deps.createBackend(conn).info();
      } catch (error) {
        return errorStatus(conn.url, error);
      }
      return saveConnection(conn);
    },

    async disconnect(): Promise<void> {
      modelsCache = null;
      await opencodeConnection.setValue(null);
    },

    models: fetchModels,

    async tabView(i: { tabId: number; hostname?: string }, sender?: Sender): Promise<TabView> {
      const fromContent = sender?.tab && !sender.url?.startsWith(browser.runtime.getURL(""));
      if (fromContent && sender?.tab?.id === undefined) throw new Error("Sender has no tab id");
      const tabId = fromContent ? (sender?.tab?.id as number) : i.tabId;
      const hostname = i.hostname || (fromContent ? hostnameOf(sender?.tab?.url) : "");
      const view = await resolveView(tabId, hostname);
      if (!fromContent || sender?.frameId === 0) await rememberHost(tabId, hostname);
      return view;
    },

    async setTabSettings(i: { tabId: number; settings: EffectiveSettings }): Promise<TabView> {
      await tabSettings(i.tabId).setValue(i.settings);
      const hostname = (await tabHostItem(i.tabId).getValue()) ?? (await tabHostname(i.tabId));
      await rememberHost(i.tabId, hostname);
      return resolveView(i.tabId, hostname);
    },

    async applyTemplate(i: {
      tabId: number;
      hostname: string;
      templateId: string;
    }): Promise<TabView> {
      const [g, templates, activeId] = await Promise.all([
        globalsItem.getValue(),
        templatesItem.getValue(),
        connectionsStore.getActiveId(),
      ]);
      const template = templates.find((t) => t.id === i.templateId);
      if (!template) throw new Error(`Template not found: ${i.templateId}`);
      await tabSettings(i.tabId).setValue(applyTemplate(template, g, activeId));
      await rememberHost(i.tabId, i.hostname);
      return resolveView(i.tabId, i.hostname);
    },

    globals: (): Promise<GlobalSettings> => globalsItem.getValue(),

    async setGlobals(g: GlobalSettings): Promise<void> {
      await globalsItem.setValue(g);
    },

    templates: (): Promise<Template[]> => templatesItem.getValue(),

    templateOp,

    languageProfiles,

    languageProfileOp,

    rules: (): Promise<SiteRule[]> => siteRulesItem.getValue(),

    async ruleOp(op: Parameters<ProtocolMap["ruleOp"]>[0]): Promise<SiteRule[]> {
      const list = await siteRulesItem.getValue();
      let next: SiteRule[];
      if (op.type === "delete") {
        next = list.filter((r) => r.id !== op.id);
      } else {
        if (!isValidPattern(op.rule.pattern))
          throw new Error(`Invalid pattern: ${op.rule.pattern}`);
        next = list.some((r) => r.id === op.rule.id)
          ? list.map((r) => (r.id === op.rule.id ? op.rule : r))
          : [...list, op.rule];
      }
      await siteRulesItem.setValue(next);
      return next;
    },

    async translateSelection(
      i: Parameters<ProtocolMap["translateSelection"]>[0],
      sender: Sender,
    ): Promise<SelectionResult> {
      const controller = new AbortController();
      if (i.requestId) selectionJobs.set(i.requestId, { controller, tabId: sender.tab?.id });
      try {
        const hostname = hostnameOf(sender.tab?.url) || i.hostname;
        const { view, model } = await requireModel(
          sender.tab?.id,
          hostname,
          "selectionModel",
          i.templateId,
        );
        const text = await deps.service.translateSelection(
          {
            text: i.text,
            context: i.context,
            settings: view.settings,
            model,
            hostname: i.hostname || hostname,
            languagePrompt: await languagePromptFor(view.settings.targetLang),
          },
          controller.signal,
        );
        return {
          text,
          sourceLang: view.settings.sourceLang,
          targetLang: view.settings.targetLang,
          model,
        };
      } catch (error) {
        const e = toBackendError(error);
        return { error: e.kind, retryAfterMs: e.retryAfterMs };
      } finally {
        if (i.requestId && selectionJobs.get(i.requestId)?.controller === controller) {
          selectionJobs.delete(i.requestId);
        }
      }
    },

    async cancelSelection(requestId: string, sender: Sender): Promise<void> {
      const job = selectionJobs.get(requestId);
      if (job && job.tabId === sender.tab?.id) job.controller.abort();
    },

    async pageBadge(state: PageState["state"], sender: Sender): Promise<void> {
      const tabId = sender.tab?.id;
      if (tabId === undefined || sender.frameId !== 0) return;
      try {
        await browser.action.setBadgeText({ tabId, text: BADGE_TEXT[state] });
        if (state === "error") {
          await browser.action.setBadgeBackgroundColor({ tabId, color: BADGE_ERROR_COLOR });
        }
      } catch {}
    },

    cacheStats: () => deps.cache.stats(),

    async cacheClear(): Promise<void> {
      await deps.cache.clear();
    },

    async pageJob(
      sender: Sender,
      req: { segments: Segment[]; page: { title: string; hostname: string } },
    ): Promise<PageJob> {
      const hostname = hostnameOf(sender.tab?.url) || req.page.hostname;
      const { view, model } = await requireModel(sender.tab?.id, hostname, "pageModel");
      return {
        segments: req.segments,
        settings: view.settings,
        model,
        languagePrompt: await languagePromptFor(view.settings.targetLang),
        page: req.page,
      };
    },

    async tabRemoved(tabId: number): Promise<void> {
      await Promise.all([tabSettings(tabId).removeValue(), tabHostItem(tabId).removeValue()]);
    },

    async tabNavigated(tabId: number, url: string): Promise<void> {
      const next = hostnameOf(url);
      const previous = await tabHostItem(tabId).getValue();
      await rememberHost(tabId, next);
      if (previous !== null && previous !== next) await tabSettings(tabId).removeValue();
    },
  };

  return handlers;
}

export type Handlers = ReturnType<typeof createHandlers>;
