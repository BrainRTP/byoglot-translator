import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { registerOnboarding } from "../../../lib/background/onboarding";
import { opencodeConnection as connectionItem } from "../../../lib/background/opencode-connection";

type Listener = (details: { reason: string }) => Promise<void>;

describe("registerOnboarding", () => {
  let onInstalled: Listener;
  const create = vi.fn();

  beforeEach(async () => {
    fakeBrowser.reset();
    create.mockClear();
    vi.spyOn(fakeBrowser.runtime.onInstalled, "addListener").mockImplementation((cb) => {
      onInstalled = cb as unknown as Listener;
    });
    vi.spyOn(fakeBrowser.tabs, "create").mockImplementation(create);
    await connectionItem.setValue(null);
    registerOnboarding();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens the onboarding page on install without a connection", async () => {
    await onInstalled({ reason: "install" });
    expect(create).toHaveBeenCalledWith({
      url: fakeBrowser.runtime.getURL("/onboarding.html"),
    });
  });

  it("does nothing on install when already connected", async () => {
    await connectionItem.setValue({
      url: "http://127.0.0.1:1",
      username: "opencode",
      password: "t",
    });
    await onInstalled({ reason: "install" });
    expect(create).not.toHaveBeenCalled();
  });

  it("does nothing on update", async () => {
    await onInstalled({ reason: "update" });
    expect(create).not.toHaveBeenCalled();
  });
});
