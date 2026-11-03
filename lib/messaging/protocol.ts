import { defineExtensionMessaging } from "@webext-core/messaging";
import type { AnimationKind } from "../dom/effects/types";
import type { BackendErrorKind, Connection, ModelInfo, ModelRef } from "../opencode/types";
import type {
  EffectiveSettings,
  GlobalSettings,
  SiteRule,
  Template,
  TemplateSettings,
} from "../settings/types";

export type Status =
  | { state: "disconnected" }
  | { state: "connected"; url: string; version: string }
  | { state: "error"; url: string; kind: BackendErrorKind; retryAfterMs?: number };

export type ResolvedModel = { model: ModelRef | null; missing: boolean };

export type TabView = {
  settings: EffectiveSettings;
  animation: AnimationKind;
  template: Template;
  modified: boolean;
  rule: SiteRule | undefined;
  pageModel: ResolvedModel;
  selectionModel: ResolvedModel;
};

export type TemplateOp =
  | { type: "create"; name: string; settings: TemplateSettings }
  | { type: "update"; id: string; patch: { name?: string; settings?: TemplateSettings } }
  | { type: "duplicate"; id: string; name: string }
  | { type: "delete"; id: string }
  | { type: "resetBuiltin" };

export type LanguageProfileView = {
  id: string;
  builtin: string;
  text: string;
  modified: boolean;
  outdated: boolean;
};

export type ProfileOp =
  | { type: "save"; id: string; text: string }
  | { type: "reset"; id: string }
  | { type: "keep"; id: string };

export type RuleOp = { type: "upsert"; rule: SiteRule } | { type: "delete"; id: string };

export type SelectionResult =
  | { text: string; sourceLang: string; targetLang: string; model: ModelRef }
  | { error: BackendErrorKind; retryAfterMs?: number };

export type PageState = {
  state: "idle" | "translating" | "translated" | "error";
  done: number;
  total: number;
  failed: number;
  error?: { kind: BackendErrorKind; retryAfterMs?: number };
};

export interface ProtocolMap {
  status(): Status;
  pair(link: string): Status;
  connectManual(c: Connection): Status;
  disconnect(): void;
  models(): ModelInfo[];
  tabView(i: { tabId: number; hostname?: string }): TabView;
  setTabSettings(i: { tabId: number; settings: EffectiveSettings }): TabView;
  applyTemplate(i: { tabId: number; hostname: string; templateId: string }): TabView;
  globals(): GlobalSettings;
  setGlobals(g: GlobalSettings): void;
  templates(): Template[];
  templateOp(op: TemplateOp): Template[];
  rules(): SiteRule[];
  ruleOp(op: RuleOp): SiteRule[];
  languageProfiles(): LanguageProfileView[];
  languageProfileOp(op: ProfileOp): LanguageProfileView[];
  translateSelection(i: {
    text: string;
    context: string;
    hostname: string;
    templateId?: string;
    requestId?: string;
  }): SelectionResult;
  cancelSelection(requestId: string): void;
  pageBadge(state: PageState["state"]): void;
  cacheStats(): { entries: number };
  cacheClear(): void;
  openOptions(): void;
}

export interface TabProtocolMap {
  pageCommand(c: "toggle" | "stop" | "restore"): PageState;
  pageState(): PageState;
  selectionCommand(): void;
}

export const { sendMessage, onMessage, removeAllListeners } =
  defineExtensionMessaging<ProtocolMap>();

export const { sendMessage: sendTabMessage, onMessage: onTabMessage } =
  defineExtensionMessaging<TabProtocolMap>();
