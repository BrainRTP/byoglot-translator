import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { exportSchema, parseExport } from "../../../lib/settings/export";
import { checkData } from "./harness";

describe("portable export contract", () => {
  checkData("schemas/export-v1.schema.json", z.toJSONSchema(exportSchema));

  it("accepts the sample with both the runtime and published schema", () => {
    const sample = JSON.parse(
      readFileSync(join(process.cwd(), "contracts", "samples", "export-v1.json"), "utf8"),
    );
    const schema = JSON.parse(
      readFileSync(join(process.cwd(), "contracts", "schemas", "export-v1.schema.json"), "utf8"),
    );
    expect(z.fromJSONSchema(schema).parse(sample)).toEqual(sample);
    expect(parseExport(sample)).toEqual(sample);
  });
});
