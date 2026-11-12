import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { isAndroid } from "../../../lib/ui/platform";

describe("isAndroid", () => {
  beforeEach(() => fakeBrowser.reset());
  afterEach(() => vi.restoreAllMocks());

  it("returns true for Android", async () => {
    vi.spyOn(fakeBrowser.runtime, "getPlatformInfo").mockResolvedValue({ os: "android" } as never);
    expect(await isAndroid()).toBe(true);
  });

  it("returns false for another platform", async () => {
    vi.spyOn(fakeBrowser.runtime, "getPlatformInfo").mockResolvedValue({ os: "mac" } as never);
    expect(await isAndroid()).toBe(false);
  });

  it("returns false when platform detection fails", async () => {
    vi.spyOn(fakeBrowser.runtime, "getPlatformInfo").mockRejectedValue(new Error("unavailable"));
    expect(await isAndroid()).toBe(false);
  });
});
