import type { BackendErrorKind } from "./types";

export class BackendError extends Error {
  kind: BackendErrorKind;
  retryAfterMs?: number;
  detail?: string;
  status?: number;

  constructor(
    kind: BackendErrorKind,
    options: { retryAfterMs?: number; detail?: string; status?: number; cause?: unknown } = {},
  ) {
    super(options.detail ? `${kind}: ${options.detail}` : kind, { cause: options.cause });
    this.name = "BackendError";
    this.kind = kind;
    this.retryAfterMs = options.retryAfterMs;
    this.detail = options.detail;
    this.status = options.status;
  }
}

export function isFatal(kind: BackendErrorKind): boolean {
  return kind !== "bad_response";
}

export function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

export function fromFetchFailure(error: unknown, signal?: AbortSignal): BackendError {
  if (isTimeout(error) || isTimeout(signal?.reason)) {
    return new BackendError("offline", { cause: error });
  }
  if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
    return new BackendError("aborted", { cause: error });
  }
  return new BackendError("offline", { cause: error });
}
