import { describe, expect, it } from "vitest";
import {
  isLocalOrigin,
  normalizeBaseUrl,
  originInUse,
  originOf,
  originPattern,
  toView,
} from "../../../lib/connections/list";
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

describe("origin helpers", () => {
  it("originOf, originPattern and isLocalOrigin throw on invalid URLs", () => {
    expect(() => originOf("not a url")).toThrow();
    expect(() => originPattern("not a url")).toThrow();
    expect(() => isLocalOrigin("not a url")).toThrow();
  });
});

describe("connection list helpers", () => {
  it("originPattern drops port and path", () => {
    expect(originPattern("http://localhost:11434/v1")).toBe("http://localhost/*");
    expect(originPattern("https://api.deepseek.com/v1/x?y=1")).toBe("https://api.deepseek.com/*");
    expect(originPattern("https://example.com:8443")).toBe("https://example.com/*");
  });

  it("originOf and isLocalOrigin", () => {
    expect(originOf("https://api.deepseek.com/v1/x")).toBe("https://api.deepseek.com");
    expect(isLocalOrigin("http://127.0.0.1:4096")).toBe(true);
    expect(isLocalOrigin("http://localhost:11434")).toBe(true);
    expect(isLocalOrigin("https://api.deepseek.com")).toBe(false);
  });

  it("normalizeBaseUrl keeps origin and path only", () => {
    expect(normalizeBaseUrl("https://u:p@host.com:8443/v1/?x=1#h")).toBe(
      "https://host.com:8443/v1",
    );
    expect(normalizeBaseUrl("https://host.com/")).toBe("https://host.com");
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

  it("originInUse ignores ports like permission patterns do", () => {
    const local = (id: string, port: number): ConnectionRecord => ({
      ...pr,
      id,
      baseUrl: `http://192.168.1.5:${port}/v1`,
    });
    const list = [local("a", 11434), local("b", 1234)];
    expect(originInUse(list, "http://192.168.1.5:11434", "a")).toBe(true);
    expect(originInUse([local("a", 11434)], "http://192.168.1.5:11434", "a")).toBe(false);
  });
});
