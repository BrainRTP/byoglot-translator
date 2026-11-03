import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  askPage,
  type PageTrack,
  pollIntervalMs,
  TimeoutError,
  trackPage,
  withTimeout,
} from "../../../lib/ui/page-bridge";

const idle = { state: "idle", done: 0, total: 0, failed: 0 } as const;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("withTimeout", () => {
  it("resolves with the value before the deadline", async () => {
    await expect(withTimeout(Promise.resolve(5), 1500)).resolves.toBe(5);
  });

  it("rejects with TimeoutError when the promise never settles", async () => {
    const result = withTimeout(new Promise<never>(() => {}), 1500);
    const assertion = expect(result).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(1500);
    await assertion;
  });

  it("passes through the original rejection", async () => {
    await expect(withTimeout(Promise.reject(new Error("boom")), 1500)).rejects.toThrow("boom");
  });

  it("clears the timer after settling", async () => {
    await withTimeout(Promise.resolve(1), 1500);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("askPage", () => {
  it("returns the page state when the content script answers", async () => {
    await expect(askPage(async () => idle)).resolves.toEqual({ available: true, state: idle });
  });

  it("maps a missing receiver to unavailable", async () => {
    const call = async () => {
      throw new Error("Could not establish connection. Receiving end does not exist.");
    };
    await expect(askPage(call)).resolves.toEqual({ available: false });
  });

  it("maps a timeout to unavailable", async () => {
    const result = askPage(() => new Promise<never>(() => {}));
    await vi.advanceTimersByTimeAsync(1500);
    await expect(result).resolves.toEqual({ available: false });
  });
});

describe("trackPage", () => {
  const translating = { state: "translating", done: 3, total: 10, failed: 0 } as const;
  const known: PageTrack = { state: translating, available: true, failures: 0 };

  it("takes a fresh state and resets the failure count", () => {
    const next = trackPage({ ...known, failures: 2 }, { available: true, state: idle });
    expect(next).toEqual({ state: idle, available: true, failures: 0 });
  });

  it("keeps the last known state on a single failure", () => {
    expect(trackPage(known, { available: false })).toEqual({
      state: translating,
      available: true,
      failures: 1,
    });
  });

  it("tolerates two failures and gives up on the third", () => {
    let track = known;
    track = trackPage(track, { available: false });
    track = trackPage(track, { available: false });
    expect(track.available).toBe(true);
    track = trackPage(track, { available: false });
    expect(track).toEqual({ state: idle, available: false, failures: 3 });
  });

  it("a success between failures restarts the count", () => {
    let track = trackPage(known, { available: false });
    track = trackPage(track, { available: true, state: translating });
    track = trackPage(track, { available: false });
    expect(track.available).toBe(true);
    expect(track.failures).toBe(1);
  });

  it("without tolerance the first failure marks the page unavailable", () => {
    expect(trackPage(known, { available: false }, 1)).toEqual({
      state: idle,
      available: false,
      failures: 1,
    });
  });
});

describe("pollIntervalMs", () => {
  it("polls fast while translating and slowly once translated", () => {
    expect(pollIntervalMs("translating")).toBe(500);
    expect(pollIntervalMs("translated")).toBe(2000);
  });

  it("does not poll when idle or in error", () => {
    expect(pollIntervalMs("idle")).toBeNull();
    expect(pollIntervalMs("error")).toBeNull();
  });
});
