import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compareOrUpdate } from "./harness";

describe("compareOrUpdate", () => {
  const file = () => join(mkdtempSync(join(tmpdir(), "contract-")), "x.json");

  it("throws with the file path when the content differs and update is off", () => {
    const path = file();
    writeFileSync(path, '{\n  "a": 1\n}\n');
    expect(() => compareOrUpdate(path, { a: 2 }, false)).toThrow(path);
  });

  it("leaves the file alone when the content is equal", () => {
    const path = file();
    writeFileSync(path, '{"a":1}');
    compareOrUpdate(path, { a: 1 }, false);
    expect(readFileSync(path, "utf8")).toBe('{"a":1}');
  });

  it("writes two-space JSON with a trailing newline when update is on", () => {
    const path = file();
    compareOrUpdate(path, { a: [1, 2] }, true);
    expect(readFileSync(path, "utf8")).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}\n');
  });
});
