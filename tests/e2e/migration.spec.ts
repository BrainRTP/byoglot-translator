import { seedLegacyConnection } from "./extension";
import { expect, test } from "./fixtures";

test("a connection saved by 0.2.7 is migrated with its models", async ({ ext, mock }) => {
  await seedLegacyConnection(ext.worker, { url: mock.url, token: mock.token });

  const options = await ext.context.newPage();
  await options.goto(`chrome-extension://${ext.id}/options.html`);
  await expect(options.getByText("Active", { exact: true })).toBeVisible();

  const stored = await ext.worker.evaluate(() =>
    chrome.storage.local.get(["connection", "connections", "activeConnectionId", "globals"]),
  );
  expect(stored.connection).toBeUndefined();
  const [record] = stored.connections as Array<Record<string, unknown>>;
  expect(record).toMatchObject({
    kind: "opencode",
    url: mock.url,
    password: mock.token,
    pageModel: { providerID: "deepseek", id: "deepseek-flash", connectionId: record?.id },
  });
  expect(stored.activeConnectionId).toBe(record?.id);
  expect(stored.globals).not.toHaveProperty("pageModel");
});
