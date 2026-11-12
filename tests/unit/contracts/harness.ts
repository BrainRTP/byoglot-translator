import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

export type ContractCase<I, E> = { name: string; input: I; expected: E };
export type ContractFile<I, E> = { contract: string; version: number; cases: ContractCase<I, E>[] };

export const UPDATE = process.env.UPDATE_CONTRACTS === "1";

export function compareOrUpdate(path: string, actual: unknown, update: boolean): void {
  if (update) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(actual, null, 2)}\n`);
    return;
  }
  try {
    expect(actual).toEqual(JSON.parse(readFileSync(path, "utf8")));
  } catch (cause) {
    throw new Error(`${path}: run UPDATE_CONTRACTS=1 pnpm test tests/unit/contracts`, { cause });
  }
}

export function runContract<I, E>(name: string, fn: (input: I) => E | Promise<E>): void {
  describe(name, () => {
    const path = join(process.cwd(), "contracts", "fixtures", `${name}.json`);
    const file: ContractFile<I, E> = JSON.parse(readFileSync(path, "utf8"));
    if (UPDATE) {
      it(`updates ${name}`, async () => {
        for (const entry of file.cases) entry.expected = await fn(entry.input);
        compareOrUpdate(path, file, true);
      });
    } else {
      for (const entry of file.cases) {
        it(entry.name, async () => {
          expect(await fn(entry.input), path).toEqual(entry.expected);
        });
      }
    }
  });
}

export function checkData(relativePath: string, actual: unknown): void {
  it(relativePath, () => {
    compareOrUpdate(join(process.cwd(), "contracts", relativePath), actual, UPDATE);
  });
}
