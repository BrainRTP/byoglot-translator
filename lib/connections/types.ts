import type { ModelRef } from "../opencode/types";

export type ProviderPreset = "deepseek" | "openrouter" | "ollama" | "lmstudio" | "custom";

export type OpencodeData = { url: string; username: string; password: string };

export type ProviderData = {
  preset: ProviderPreset;
  name: string;
  baseUrl: string;
  apiKey: string;
};

export type ConnectionModels = { pageModel: ModelRef | null; selectionModel: ModelRef | null };

export type ConnectionRecord = (
  | ({ kind: "opencode" } & OpencodeData)
  | ({ kind: "provider" } & ProviderData)
) &
  ConnectionModels & { id: string };

export type ConnectionView = {
  id: string;
  kind: ConnectionRecord["kind"];
  name: string;
  url: string;
  preset?: ProviderPreset;
  hasKey: boolean;
  active: boolean;
};

export type ConnectionKind = ConnectionRecord["kind"];
