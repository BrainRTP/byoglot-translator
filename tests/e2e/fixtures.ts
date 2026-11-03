import { test as base } from "@playwright/test";
import { type Extension, launchExtension, seedConnection } from "./extension";
import { type MockMode, type MockOpencode, startMockOpencode } from "./mock-opencode";

type Fixtures = {
  mockMode: MockMode;
  mock: MockOpencode;
  ext: Extension;
  paired: Extension;
};

export const test = base.extend<Fixtures>({
  mockMode: ["ok", { option: true }],
  mock: async ({ mockMode }, use) => {
    const mock = await startMockOpencode({ mode: mockMode });
    await use(mock);
    await mock.stop();
  },
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured first argument
  ext: async ({}, use) => {
    const ext = await launchExtension();
    await use(ext);
    await ext.context.close();
  },
  paired: async ({ ext, mock }, use) => {
    await seedConnection(ext.worker, { url: mock.url, token: mock.token });
    await use(ext);
  },
});

export { expect } from "@playwright/test";
