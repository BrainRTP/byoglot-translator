import { expect, test } from "./fixtures";

test("Android onboarding waits for the platform and loads settings in parallel", async ({
  ext,
}) => {
  const page = await ext.context.newPage();
  await page.addInitScript(() => {
    const state = window as unknown as { releasePlatform?: () => void; globalsRequested?: boolean };
    const platformInfo = { os: "android", arch: "arm", nacl_arch: "arm" };
    Object.assign(chrome.runtime, {
      getPlatformInfo: (callback?: (info: typeof platformInfo) => void) =>
        new Promise<typeof platformInfo>((resolve) => {
          state.releasePlatform = () => {
            callback?.(platformInfo);
            resolve(platformInfo);
          };
        }),
    });
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = ((msg: { type?: string }, cb: (r: unknown) => void) => {
      if (msg?.type === "globals") state.globalsRequested = true;
      return send(msg, cb);
    }) as never;
  });
  await page.goto(`chrome-extension://${ext.id}/onboarding.html`);
  await page.waitForFunction(
    () => (window as unknown as { releasePlatform?: () => void }).releasePlatform,
  );
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { globalsRequested?: boolean }).globalsRequested),
    )
    .toBe(true);
  await expect(page.getByLabel("Connection link")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Connection type" })).toHaveCount(0);

  await page.evaluate(() =>
    (window as unknown as { releasePlatform?: () => void }).releasePlatform?.(),
  );
  await expect(page.getByLabel("API key")).toBeVisible();
  await expect(page.getByRole("group", { name: "Connection type" })).toHaveCount(0);
});

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

test("kind switch is disabled while opencode connects", async ({ ext, mock }) => {
  mock.pairDelayMs = 1500;
  const page = await ext.context.newPage();
  await page.goto(`chrome-extension://${ext.id}/onboarding.html`);

  await page.getByLabel("Connection link").fill(`${mock.url}/auth/connect/${mock.pairCode}`);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("button", { name: "My provider" })).toBeDisabled();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
});
