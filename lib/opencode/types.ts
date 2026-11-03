export type ModelRef = { providerID: string; id: string; variant?: string };

export type ModelInfo = {
  providerID: string;
  id: string;
  name: string;
  variants: string[];
  contextLimit: number;
  outputLimit: number;
};

export type ServerInfo = { version: string };

export type Connection = { url: string; username: string; password: string };

export type BackendErrorKind =
  | "offline"
  | "unauthorized"
  | "rate_limit"
  | "provider_auth"
  | "provider_error"
  | "bad_response"
  | "incompatible"
  | "no_model"
  | "aborted";

export interface TranslationBackend {
  info(signal?: AbortSignal): Promise<ServerInfo>;
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>;
  defaultModel(signal?: AbortSignal): Promise<ModelInfo | null>;
  generate(prompt: string, model: ModelRef, signal?: AbortSignal): Promise<string>;
}
