import { describe, expect, it } from "vitest";
import { isLocalOrigin, originInUse, originOf, toView } from "../../../lib/connections/list";
import type { ConnectionRecord } from "../../../lib/connections/types";

const models = { pageModel: null, selectionModel: null };
const oc: ConnectionRecord = {
  kind: "opencode",
  id: "o",
  url: "http://127.0.0.1:4096",
  username: "opencode",
  password: "secret-pass",
  ...models,
};
const pr: ConnectionRecord = {
  kind: "provider",
  id: "p",
  preset: "deepseek",
  name: "DeepSeek",
  baseUrl: "https://api.deepseek.com",
  apiKey: "sk-secret-key",
  ...models,
};

describe("connection list helpers", () => {
  it("originOf and isLocalOrigin", () => {
    expect(originOf("https://api.deepseek.com/v1/x")).toBe("https://api.deepseek.com");
    expect(isLocalOrigin("http://127.0.0.1:4096")).toBe(true);
    expect(isLocalOrigin("http://localhost:11434")).toBe(true);
    expect(isLocalOrigin("https://api.deepseek.com")).toBe(false);
  });

  it("toView never leaks the key or password", () => {
    const a = toView(oc, "o");
    const b = toView(pr, "o");
    expect(JSON.stringify(a)).not.toContain("secret-pass");
    expect(JSON.stringify(b)).not.toContain("sk-secret-key");
    expect(a).toMatchObject({
      name: "opencode",
      url: "http://127.0.0.1:4096",
      hasKey: true,
      active: true,
    });
    expect(b).toMatchObject({
      name: "DeepSeek",
      url: "https://api.deepseek.com",
      preset: "deepseek",
      hasKey: true,
      active: false,
    });
  });

  it("toView reports hasKey false for an empty key", () => {
    expect(toView({ ...pr, apiKey: "" } as ConnectionRecord, null).hasKey).toBe(false);
  });

  it("originInUse honors exceptId", () => {
    const list = [oc, pr];
    expect(originInUse(list, "https://api.deepseek.com")).toBe(true);
    expect(originInUse(list, "https://api.deepseek.com", "p")).toBe(false);
    expect(originInUse(list, "https://openrouter.ai")).toBe(false);
  });
});
