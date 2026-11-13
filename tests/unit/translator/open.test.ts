import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { openTranslator } from "../../../lib/translator/open";

describe("openTranslator", () => {
  beforeEach(() => fakeBrowser.reset());
  afterEach(() => vi.restoreAllMocks());

  it("focuses the existing translator tab and its window", async () => {
    vi.spyOn(fakeBrowser.tabs, "query").mockResolvedValue([{ id: 17, windowId: 4 }] as never);
    const update = vi.spyOn(fakeBrowser.tabs, "update").mockResolvedValue({} as never);
    const focus = vi.spyOn(fakeBrowser.windows, "update").mockResolvedValue({} as never);
    const create = vi.spyOn(fakeBrowser.tabs, "create");
    await openTranslator();
    expect(update).toHaveBeenCalledWith(17, { active: true });
    expect(focus).toHaveBeenCalledWith(4, { focused: true });
    expect(create).not.toHaveBeenCalled();
  });

  it("opens a translator tab when there is no existing one", async () => {
    const query = vi.spyOn(fakeBrowser.tabs, "query").mockResolvedValue([] as never);
    const create = vi.spyOn(fakeBrowser.tabs, "create").mockResolvedValue({} as never);
    await openTranslator();
    expect(query).toHaveBeenCalledWith({ url: fakeBrowser.runtime.getURL("/translator.html") });
    expect(create).toHaveBeenCalledWith({ url: fakeBrowser.runtime.getURL("/translator.html") });
  });

  it("focuses the tab without using the windows API on Android", async () => {
    vi.spyOn(fakeBrowser.tabs, "query").mockResolvedValue([{ id: 17, windowId: 4 }] as never);
    vi.spyOn(fakeBrowser.runtime, "getPlatformInfo").mockResolvedValue({ os: "android" } as never);
    const update = vi.spyOn(fakeBrowser.tabs, "update").mockResolvedValue({} as never);
    const focus = vi.spyOn(fakeBrowser.windows, "update");
    await openTranslator();
    expect(update).toHaveBeenCalledWith(17, { active: true });
    expect(focus).not.toHaveBeenCalled();
  });
});
