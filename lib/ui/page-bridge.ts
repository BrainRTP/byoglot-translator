import type { PageState } from "../messaging/protocol";

export const PAGE_TIMEOUT_MS = 1500;

export class TimeoutError extends Error {
  constructor() {
    super("timeout");
    this.name = "TimeoutError";
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number = PAGE_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export type PageResult = { available: true; state: PageState } | { available: false };

/** Any failure (no content script in the top frame, timeout) means the page is not available. */
export async function askPage(
  call: () => Promise<PageState>,
  ms: number = PAGE_TIMEOUT_MS,
): Promise<PageResult> {
  try {
    return { available: true, state: await withTimeout(call(), ms) };
  } catch {
    return { available: false };
  }
}

export const MAX_POLL_FAILURES = 3;

export type PageTrack = { state: PageState; available: boolean; failures: number };

const IDLE: PageState = { state: "idle", done: 0, total: 0, failed: 0 };

/** Keeps the last known state through transient failures, gives up after `tolerance` in a row. */
export function trackPage(
  prev: PageTrack,
  result: PageResult,
  tolerance: number = MAX_POLL_FAILURES,
): PageTrack {
  if (result.available) return { state: result.state, available: true, failures: 0 };
  const failures = prev.failures + 1;
  if (failures >= tolerance) return { state: IDLE, available: false, failures };
  return { state: prev.state, available: prev.available, failures };
}

export function pollIntervalMs(state: PageState["state"]): number | null {
  if (state === "translating") return 500;
  if (state === "translated") return 2000;
  return null;
}
