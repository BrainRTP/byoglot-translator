import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, loadRun, loadSnapshot } from "./lib/paths.ts";
import { renderReader } from "./lib/render.ts";
import {
  buildCalibration,
  buildRound,
  JUDGED_MIN_CHARS,
  type RoundKey,
  scoreRound,
  slot,
  type Verdict,
} from "./lib/round.ts";

const [command = "", ...rest] = process.argv.slice(2);
const arg = (name: string, fallback = "") => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? (rest[i + 1] ?? fallback) : fallback;
};
const roundId = arg("round");
if (!roundId) throw new Error("--round <id> is required");
const roundDir = join(DATA, "rounds", roundId);
const keyPath = join(DATA, "keys", `${roundId}.json`);
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

function loadVerdicts(): Verdict[] {
  return readdirSync(roundDir)
    .filter((f) => /^verdicts-\d+\.json$/.test(f))
    .flatMap((f) => readJson<{ items: Verdict[] }>(join(roundDir, f)).items);
}

function loadVerified(): Record<string, boolean> {
  const path = join(roundDir, "verified.json");
  if (!existsSync(path)) return {};
  const raw = readJson<Record<string, { confirmed: boolean } | boolean>>(path);
  return Object.fromEntries(
    Object.entries(raw).map(([id, v]) => [id, typeof v === "boolean" ? v : v.confirmed]),
  );
}

const key = () => readJson<RoundKey & { snapshot: string }>(keyPath);

if (command === "build") {
  const runs = arg("runs").split(",").filter(Boolean).map(loadRun);
  const snapshotId = runs[0]?.config.snapshot ?? "";
  const snapshot = loadSnapshot(snapshotId);
  const { parts, key: built } = buildRound(runs, snapshot, {
    roundId,
    parts: Number(arg("parts", "1")),
    seed: Number(arg("seed", "1")),
  });
  mkdirSync(roundDir, { recursive: true });
  mkdirSync(join(DATA, "keys"), { recursive: true });
  for (const [i, p] of parts.entries()) writeFileSync(join(roundDir, `part-${i + 1}.md`), p);
  writeFileSync(keyPath, JSON.stringify({ ...built, snapshot: snapshotId }, null, 1));
  console.log(
    `${roundId}: ${Object.keys(built.items).length} items in ${parts.length} parts -> ${roundDir}`,
  );
} else if (command === "verify-list") {
  const k = key();
  const snapshot = loadSnapshot(k.snapshot);
  const segs = new Map(
    [
      ...snapshot.segments,
      ...snapshot.selections.map((s) => ({ id: s.id, text: s.text, slots: {} })),
    ].map((s) => [s.id, s]),
  );
  const out: string[] = [];
  for (const v of loadVerdicts()) {
    for (const [label, given] of Object.entries(v.labels)) {
      if (given.label !== "meaning") continue;
      const seg = segs.get(v.item);
      const text = k.items[v.item]?.[label]?.text ?? null;
      if (!seg || text === null) continue;
      out.push(
        `## ${v.item}:${label}\nSRC: ${renderReader(seg.text, seg.slots)}\nOUT: ${renderReader(text, seg.slots)}\nЗамечание судьи: ${given.note}`,
      );
    }
  }
  writeFileSync(
    join(roundDir, "verify.md"),
    `# Флаги на проверку (${out.length})\n\n${out.join("\n\n")}\n`,
  );
  console.log(`${roundId}: ${out.length} meaning flags -> ${join(roundDir, "verify.md")}`);
} else if (command === "score") {
  const k = key();
  const verdicts = loadVerdicts();
  const score = scoreRound(verdicts, k, loadVerified());
  const snapshot = loadSnapshot(k.snapshot);
  const classOf = new Map(
    snapshot.segments
      .filter((s) => s.text.length > JUDGED_MIN_CHARS)
      .map((s) => [
        s.id,
        s.text.length > 300 ? "long" : Object.keys(s.slots).length > 0 ? "code" : "plain",
      ]),
  );
  const byClass: Record<string, Record<string, { ok: number; n: number }>> = {};
  for (const v of verdicts) {
    for (const [label, variant] of Object.entries(k.items[v.item] ?? {})) {
      const cls = classOf.get(v.item) ?? "plain";
      const c = slot(
        slot(byClass, variant.run, () => ({})),
        cls,
        () => ({ ok: 0, n: 0 }),
      );
      c.n++;
      if (variant.text !== null && v.labels[label]?.label === "ok") c.ok++;
    }
  }
  writeFileSync(join(roundDir, "score.json"), JSON.stringify({ ...score, byClass }, null, 1));
  console.log("run\tjudged\tok%\tstyle\tmeaning\tconfirmed\tok% by class (plain/code/long)");
  for (const [run, s] of Object.entries(score.perRun)) {
    const cls = ["plain", "code", "long"]
      .map((c) => {
        const x = byClass[run]?.[c];
        return x ? `${Math.round((100 * x.ok) / x.n)}%/${x.n}` : "-";
      })
      .join(" ");
    console.log(
      `${run}\t${s.judged}\t${Math.round((100 * s.ok) / Math.max(1, s.judged))}\t${s.style}\t${s.meaning}\t${s.meaningConfirmed}\t${cls}`,
    );
  }
  console.log("\npair\twins\tlosses\tties\twin% of decided");
  for (const [pair, p] of Object.entries(score.pairwise)) {
    const decided = p.wins + p.losses;
    console.log(
      `${pair}\t${p.wins}\t${p.losses}\t${p.ties}\t${decided ? Math.round((100 * p.wins) / decided) : "-"}`,
    );
  }
} else if (command === "calibration") {
  const k = key();
  const cal = buildCalibration(loadVerdicts(), k, loadSnapshot(k.snapshot), {
    pairs: 10,
    labels: 5,
    seed: Number(arg("seed", "1")),
  });
  mkdirSync(join(DATA, "calibration"), { recursive: true });
  writeFileSync(join(DATA, "calibration", `${roundId}.md`), cal.markdown);
  writeFileSync(
    join(DATA, "keys", `${roundId}-calibration.json`),
    JSON.stringify(cal.answers, null, 1),
  );
  console.log(
    `${roundId}: ${cal.answers.pairs.length} pairs, ${cal.answers.labels.length} labels -> ${join(DATA, "calibration", `${roundId}.md`)}`,
  );
} else {
  throw new Error(`unknown command ${command}: build | verify-list | score | calibration`);
}
