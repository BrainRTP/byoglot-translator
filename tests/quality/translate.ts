import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parsePageResponse, placeholderSignature } from "../../lib/translate/parse.ts";
import { packBatches } from "./lib/batching.ts";
import { fromVisible, toVisible } from "./lib/code-visible.ts";
import { buildGlossaryPrompt, glossaryCandidates, parseGlossary } from "./lib/glossary.ts";
import { generate, limiter } from "./lib/opencode.ts";
import { DATA, loadSnapshot, readPrompt } from "./lib/paths.ts";
import { buildPrompt, buildSelectionLabPrompt } from "./lib/prompt.ts";
import { renderReader } from "./lib/render.ts";
import type { Row, RunConfig, RunResult, RunStats, Segment } from "./lib/types.ts";

function parseArgs(argv: string[]): { config: RunConfig; runId: string } {
  let base: Partial<RunConfig> = {};
  let runId = "";
  const sets: [string, string][] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1] ?? "";
    if (arg === "--config") base = JSON.parse(readFileSync(next, "utf8")) as Partial<RunConfig>;
    else if (arg === "--run") runId = next;
    else if (arg === "--set") sets.push(next.split(/=(.*)/s).slice(0, 2) as [string, string]);
    else continue;
    i++;
  }
  const config = { ...base } as Record<string, unknown>;
  for (const [key, value] of sets) {
    config[key] = value === "null" ? null : /^\d+$/.test(value) ? Number(value) : value;
  }
  if (!runId) throw new Error("--run <runId> is required");
  return { config: config as RunConfig, runId };
}

const { config, runId } = parseArgs(process.argv.slice(2));
const OUT = join(DATA, "runs", runId);
mkdirSync(join(OUT, "raw"), { recursive: true });
const snapshot = loadSnapshot(config.snapshot);
const frame = readPrompt(config.frame);
const languagePrompt = config.languagePrompt ? readPrompt(config.languagePrompt) : null;
const template = readPrompt(config.template);
let glossary = config.glossary && config.glossary !== "auto" ? readPrompt(config.glossary) : null;
const byId = new Map(snapshot.segments.map((s) => [s.id, s]));
const visible = config.codeMode === "visible";
const limit = limiter(4);
const started = Date.now();
const stats: RunStats = {
  calls: 0,
  transportErrors: 0,
  firstPassFailed: [],
  finalFailed: [],
  firstBatchMs: 0,
  totalMs: 0,
};
const result = new Map<string, string>();
let callNo = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(prompt: string, tag: string): Promise<string> {
  const no = String(++callNo).padStart(3, "0");
  let raw = "";
  for (const backoff of [5_000, 20_000, 60_000, 0]) {
    try {
      raw = await limit(() => generate(prompt, config.effort));
      break;
    } catch (error) {
      raw = `ERROR: ${error instanceof Error ? error.message.slice(-300) : String(error)}`;
      stats.transportErrors++;
      if (backoff) await sleep(backoff);
    }
  }
  stats.calls++;
  writeFileSync(join(OUT, "raw", `${no}-${tag}.txt`), `${prompt}\n\n===== RESPONSE =====\n${raw}`);
  return raw;
}

async function attemptPage(batch: Segment[], tag: string, hideCode = false): Promise<string[]> {
  const showCode = visible && !hideCode;
  const input = Object.fromEntries(
    batch.map((s) => [s.id, showCode ? toVisible(s.text, s.slots) : s.text]),
  );
  const prompt = buildPrompt({
    frame,
    languagePrompt,
    template,
    glossary,
    sourceLang: "auto",
    targetLang: config.targetLang,
    pageTitle: snapshot.title,
    hostname: snapshot.hostname,
    segments: input,
  });
  const { ok, failed } = parsePageResponse(await call(prompt, tag), input);
  const bad = [...failed];
  for (const [id, text] of Object.entries(ok)) {
    const source = byId.get(id)?.text ?? "";
    const hidden = showCode ? fromVisible(text, byId.get(id)?.slots ?? {}) : text;
    if (hidden === null || placeholderSignature(hidden) !== placeholderSignature(source))
      bad.push(id);
    else result.set(id, hidden);
  }
  if (bad.length < batch.length && stats.firstBatchMs === 0)
    stats.firstBatchMs = Date.now() - started;
  return bad;
}

async function prepareGlossary(): Promise<void> {
  if (config.glossary !== "auto") return;
  const t0 = Date.now();
  const terms = glossaryCandidates(snapshot);
  const raw = await call(buildGlossaryPrompt(terms, config.targetLang, languagePrompt), "glossary");
  const entries = Object.entries(parseGlossary(raw)).map(([term, tr]) => `${term} = ${tr}`);
  glossary = entries.length
    ? `Use exactly these translations for these terms and titles.\n${entries.join("\n")}`
    : null;
  stats.glossaryMs = Date.now() - t0;
  writeFileSync(join(OUT, "glossary.txt"), glossary ?? "");
}

async function runPage(): Promise<Row[]> {
  await prepareGlossary();
  const batches = packBatches(snapshot.segments, config.maxBlocks, config.maxChars);
  await Promise.all(
    batches.map(async (batch, i) => {
      let failed = await attemptPage(batch, `b${i}`);
      if (failed.length === 0) return;
      stats.firstPassFailed.push(...failed);
      const regroup = batch.filter((s) => failed.includes(s.id));
      failed = await attemptPage(regroup, `b${i}-retry`);
      if (failed.length === 0) return;
      const singles = regroup.filter((s) => failed.includes(s.id));
      await Promise.all(
        singles.map(async (s) => {
          const left = await attemptPage([s], `${s.id}-single`);
          if (left.length > 0 && visible) {
            stats.hiddenFallbacks = (stats.hiddenFallbacks ?? 0) + 1;
            await attemptPage([s], `${s.id}-hidden`, true);
          }
        }),
      );
    }),
  );
  return snapshot.segments.map((s) => ({
    id: s.id,
    source: s.text,
    translation: result.get(s.id) ?? null,
  }));
}

async function runSelection(): Promise<Row[]> {
  return Promise.all(
    snapshot.selections.map(async (sel) => {
      const prompt = buildSelectionLabPrompt({
        frame,
        languagePrompt,
        template,
        sourceLang: "auto",
        targetLang: config.targetLang,
        hostname: sel.hostname ?? snapshot.hostname,
        text: sel.text,
        context: sel.context,
      });
      for (const tag of [sel.id, `${sel.id}-retry`]) {
        const raw = await call(prompt, tag);
        if (!raw.startsWith("ERROR: ") && raw.trim()) {
          if (stats.firstBatchMs === 0) stats.firstBatchMs = Date.now() - started;
          return { id: sel.id, source: sel.text, translation: raw.trim() };
        }
        if (tag === sel.id) stats.firstPassFailed.push(sel.id);
      }
      return { id: sel.id, source: sel.text, translation: null };
    }),
  );
}

const rows = config.mode === "selection" ? await runSelection() : await runPage();
stats.finalFailed = rows.filter((r) => r.translation === null).map((r) => r.id);
stats.totalMs = Date.now() - started;
const run: RunResult = { runId, config, rows, stats };
writeFileSync(join(OUT, "result.json"), JSON.stringify(run, null, 1));
const slotsOf = new Map(snapshot.segments.map((s) => [s.id, s.slots]));
writeFileSync(
  join(OUT, "side-by-side.md"),
  rows
    .map((r) => {
      const slots = slotsOf.get(r.id) ?? {};
      const ru = r.translation === null ? "!!! FAILED" : renderReader(r.translation, slots);
      return `### ${r.id}\nSRC: ${renderReader(r.source, slots)}\nOUT: ${ru}\n`;
    })
    .join("\n"),
);
console.log(
  `${runId}: calls=${stats.calls} transportErrors=${stats.transportErrors} firstPassFailed=${stats.firstPassFailed.length} finalFailed=${stats.finalFailed.length} first=${(stats.firstBatchMs / 1000).toFixed(1)}s total=${(stats.totalMs / 1000).toFixed(1)}s`,
);
