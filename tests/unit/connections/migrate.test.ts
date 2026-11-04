import { describe, expect, it } from "vitest";
import { migrateLegacy } from "../../../lib/connections/migrate";
import type { Template } from "../../../lib/settings/types";

const legacy = { url: "http://127.0.0.1:4096", username: "opencode", password: "tok" };
const page = { providerID: "deepseek", id: "deepseek-flash", variant: "none" };

describe("migrateLegacy", () => {
  it("turns the old connection and globals models into one active opencode record", () => {
    const result = migrateLegacy(legacy, { pageModel: page, selectionModel: null }, [], () => "c1");
    expect(result).toEqual({
      connections: [
        {
          kind: "opencode",
          id: "c1",
          ...legacy,
          pageModel: { ...page, connectionId: "c1" },
          selectionModel: null,
        },
      ],
      activeId: "c1",
      templates: [],
    });
  });

  it("stamps template models and leaves other templates untouched", () => {
    const plain: Template = { id: "a", name: "A", builtin: false, settings: { prePrompt: "p" } };
    const withModel: Template = {
      id: "b",
      name: "B",
      builtin: false,
      settings: { prePrompt: "q", selectionModel: page },
    };
    const result = migrateLegacy(legacy, {}, [plain, withModel], () => "c1");
    expect(result?.templates[0]).toBe(plain);
    expect(result?.templates[1]?.settings.selectionModel).toEqual({ ...page, connectionId: "c1" });
    expect(withModel.settings.selectionModel).toEqual(page);
  });

  it("returns null when there is no legacy connection", () => {
    expect(migrateLegacy(null, { pageModel: page }, [], () => "c1")).toBeNull();
  });
});
