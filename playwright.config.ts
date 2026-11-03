import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  reporter: "list",
  projects: [
    { name: "mock", testMatch: "*.spec.ts", timeout: 30_000 },
    { name: "live", testMatch: "live/*.live.ts", timeout: 180_000 },
  ],
});
