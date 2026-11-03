import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RunResult, Snapshot } from "./types.ts";

export const ROOT = process.cwd();
export const QUALITY = join(ROOT, "tests/quality");
export const DATA = join(QUALITY, ".data");
export const PROMPTS = join(QUALITY, "prompts");

export const readPrompt = (path: string) => readFileSync(join(PROMPTS, path), "utf8");
export const loadSnapshot = (id: string): Snapshot =>
  JSON.parse(readFileSync(join(DATA, "corpus", `${id}.json`), "utf8")) as Snapshot;
export const loadRun = (runId: string): RunResult =>
  JSON.parse(readFileSync(join(DATA, "runs", runId, "result.json"), "utf8")) as RunResult;
