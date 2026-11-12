import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { exportSchema, parseExport } from "../../../lib/settings/export";
import { checkData } from "./harness";

describe("portable export contract", () => {
  checkData("schemas/export-v1.schema.json", z.toJSONSchema(exportSchema));

  it("accepts the export-v1 sample without changes", () => {
    const sample = JSON.parse(
      readFileSync(join(process.cwd(), "contracts", "fixtures", "export-v1.json"), "utf8"),
    );
    expect(parseExport(sample)).toEqual(sample);
  });
});
