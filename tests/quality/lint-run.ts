import { lint } from "./lib/lint.ts";
import { loadRun, loadSnapshot } from "./lib/paths.ts";

const ids = process.argv.slice(2);
const head = [
  "run",
  "fail1",
  "fail",
  "enLeft",
  "words",
  "явля",
  "факт",
  "поср",
  "осущ",
  "данн",
  "рассм",
  "вы",
  "yo",
  "avgS",
  "maxS",
  "first",
  "total",
];
console.log(head.join("\t"));
const variants: string[] = [];
for (const id of ids) {
  const run = loadRun(id);
  const r = lint(run.rows, loadSnapshot(run.config.snapshot));
  const m = r.markersPer1000;
  console.log(
    [
      id,
      run.stats.firstPassFailed.length,
      r.finalFailed.length,
      r.englishLeft.length,
      r.words,
      m.явля,
      m.фактическ,
      m.посредством,
      m.осуществл,
      m.данный,
      m["рассмотрите возможность"],
      m.вы,
      r.yoCount,
      r.avgSentenceWords,
      r.maxSentenceWords,
      (run.stats.firstBatchMs / 1000).toFixed(0),
      (run.stats.totalMs / 1000).toFixed(0),
    ].join("\t"),
  );
  variants.push(
    `${id}: ${Object.entries(r.termVariants)
      .map(([t, v]) => `${t}=${v.join("|")}`)
      .join("  ")}`,
  );
  if (process.env.SHOW_EN)
    for (const e of r.englishLeft) variants.push(`  en ${e.id}: ${e.phrase}`);
}
console.log(`\n${variants.join("\n")}`);
