import { expect, test } from "./fixtures";

test("pairs through onboarding and rejects the same link the second time", async ({
  ext,
  mock,
}) => {
  const link = `${mock.url}/auth/connect/${mock.pairCode}`;
  const page = await ext.context.newPage();
  await page.goto(`chrome-extension://${ext.id}/onboarding.html`);

  await page.getByLabel("Connection link").fill(link);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await expect(page.getByText("opencode 2.2.5")).toBeVisible();

  const stored = await ext.worker.evaluate(async () => {
    const { connections } = await chrome.storage.local.get("connections");
    return connections as { kind: string; url: string; username: string; password: string }[];
  });
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({
    kind: "opencode",
    url: mock.url,
    username: "opencode",
    password: mock.token,
  });

  await page.goto(`chrome-extension://${ext.id}/onboarding.html`);
  await page.getByLabel("Connection link").fill(link);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Link expired");
});
