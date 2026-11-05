import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { registerCommands, SELECTION_MENU_ID } from "../../../lib/background/commands";

type Listener = (...args: never[]) => unknown;

describe("registerCommands", () => {
  let onCommand: Listener;
  let onClicked: Listener;
  let sendMessage: ReturnType<typeof vi.fn>;
  const create = vi.fn();
  const removeAll = vi.fn(async () => {});

  beforeEach(() => {
    fakeBrowser.reset();
    create.mockClear();
    removeAll.mockClear();
    vi.spyOn(fakeBrowser.commands.onCommand, "addListener").mockImplementation((cb) => {
      onCommand = cb as Listener;
    });
    vi.spyOn(fakeBrowser.contextMenus.onClicked, "addListener").mockImplementation((cb) => {
      onClicked = cb as Listener;
    });
    vi.spyOn(fakeBrowser.contextMenus, "create").mockImplementation(create);
    vi.spyOn(fakeBrowser.contextMenus, "removeAll").mockImplementation(removeAll);
    vi.spyOn(fakeBrowser.i18n, "getMessage").mockReturnValue("Translate selection");
    vi.spyOn(fakeBrowser.tabs, "query").mockResolvedValue([{ id: 7 }] as never);
    sendMessage = vi.fn((_tabId, _message, _options, cb) => cb({ res: undefined }));
    vi.spyOn(fakeBrowser.tabs, "sendMessage").mockImplementation(sendMessage as never);
    registerCommands();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const sent = () =>
    sendMessage.mock.calls.map(([tabId, message, options]) => ({
      tabId,
      type: message.type,
      data: message.data,
      options,
    }));

  it("translate-page toggles the page in the active tab", async () => {
    await (onCommand as (c: string) => Promise<void>)("translate-page");
    expect(sent()).toEqual([{ tabId: 7, type: "pageCommand", data: "toggle", options: undefined }]);
  });

  it("translate-selection sends selectionCommand to the active tab", async () => {
    await (onCommand as (c: string) => Promise<void>)("translate-selection");
    expect(sent()).toMatchObject([{ tabId: 7, type: "selectionCommand" }]);
  });

  it("insert-selection sends selectionInsertCommand to the active tab", async () => {
    await (onCommand as (c: string) => Promise<void>)("insert-selection");
    expect(sent()).toMatchObject([{ tabId: 7, type: "selectionInsertCommand" }]);
  });

  it("ignores unknown commands and tabs without a content script", async () => {
    await (onCommand as (c: string) => Promise<void>)("other");
    expect(sendMessage).not.toHaveBeenCalled();
    sendMessage.mockImplementation(() => {
      throw new Error("no receiver");
    });
    await expect(
      (onCommand as (c: string) => Promise<void>)("translate-page"),
    ).resolves.toBeUndefined();
  });

  it("creates the context menu item on install", async () => {
    await (
      fakeBrowser.runtime.onInstalled as unknown as { trigger(d: unknown): Promise<void> }
    ).trigger({
      reason: "install",
    });
    expect(removeAll).toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith({
      id: SELECTION_MENU_ID,
      title: "Translate selection",
      contexts: ["selection"],
    });
  });

  it("context menu click sends selectionCommand to that tab and frame", async () => {
    await (onClicked as (i: unknown, t: unknown) => Promise<void>)(
      { menuItemId: SELECTION_MENU_ID, frameId: 4 },
      { id: 9 },
    );
    expect(sent()).toEqual([
      { tabId: 9, type: "selectionCommand", data: undefined, options: { frameId: 4 } },
    ]);
  });

  it("ignores clicks from other menu items", async () => {
    await (onClicked as (i: unknown, t: unknown) => Promise<void>)(
      { menuItemId: "other" },
      { id: 9 },
    );
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
