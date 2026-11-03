import { renderReader } from "./render.ts";
import type { RunResult, Snapshot } from "./types.ts";

export type Label = "ok" | "style" | "meaning";
export type Verdict = {
  item: string;
  ranking: string[];
  labels: Record<string, { label: Label; note: string }>;
};
type Variant = { run: string; text: string | null };
export type RoundKey = {
  roundId: string;
  items: Record<string, Record<string, Variant>>;
  shortLists: Record<string, string>;
};
export type RunScore = {
  ok: number;
  style: number;
  meaning: number;
  meaningConfirmed: number;
  judged: number;
};
export type PairScore = { wins: number; losses: number; ties: number };
export type RoundScore = { perRun: Record<string, RunScore>; pairwise: Record<string, PairScore> };

export const JUDGED_MIN_CHARS = 60;
const LABELS = ["A", "B", "C", "D"];
const MISSING = "(нет перевода)";

function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

const show = (text: string | null, slots: Record<string, string>) =>
  text === null ? MISSING : renderReader(text, slots);

export function buildRound(
  runs: RunResult[],
  snapshot: Snapshot,
  opts: { roundId: string; parts: number; seed: number },
): { parts: string[]; key: RoundKey } {
  if (runs.length < 2 || runs.length > LABELS.length) throw new Error("a round needs 2-4 runs");
  const byRun = runs.map((r) => new Map(r.rows.map((row) => [row.id, row.translation])));
  const key: RoundKey = { roundId: opts.roundId, items: {}, shortLists: {} };
  const blocks: string[] = [];
  const selectionMode = snapshot.segments.length === 0;
  const judged = selectionMode
    ? snapshot.selections.map((s) => ({ id: s.id, text: s.text, slots: {}, context: s.context }))
    : snapshot.segments
        .filter((s) => s.text.length > JUDGED_MIN_CHARS)
        .map((s) => ({ ...s, context: "" }));
  for (const seg of judged) {
    const order = shuffle(
      runs.map((_, i) => i),
      random(opts.seed ^ hash(seg.id)),
    );
    const entry: Record<string, Variant> = {};
    const lines = [`## ${seg.id}`];
    if (seg.context) lines.push(`CTX: ${seg.context}`);
    lines.push(`SRC: ${renderReader(seg.text, seg.slots)}`);
    order.forEach((ri, li) => {
      const label = LABELS[li] as string;
      const text = byRun[ri]?.get(seg.id) ?? null;
      entry[label] = { run: runs[ri]?.runId ?? "", text };
      lines.push(`${label}: ${show(text, seg.slots)}`);
    });
    key.items[seg.id] = entry;
    blocks.push(lines.join("\n"));
  }

  const short = snapshot.segments.filter((s) => s.text.length <= JUDGED_MIN_CHARS);
  const shortText = shuffle(
    runs.map((_, i) => i),
    random(opts.seed),
  )
    .map((ri, li) => {
      const name = `S${li + 1}`;
      key.shortLists[name] = runs[ri]?.runId ?? "";
      const lines = short.map(
        (s) =>
          `- ${renderReader(s.text, s.slots)} => ${show(byRun[ri]?.get(s.id) ?? null, s.slots)}`,
      );
      return `### Список ${name}\n${lines.join("\n")}`;
    })
    .join("\n\n");

  const per = Math.ceil(blocks.length / opts.parts);
  const parts = Array.from({ length: opts.parts }, (_, k) =>
    [
      `# Раунд ${opts.roundId}, часть ${k + 1} из ${opts.parts}`,
      `Страница: ${snapshot.title} (${snapshot.url}). В каждом блоке варианты перемешаны заново.`,
      ...blocks.slice(k * per, (k + 1) * per),
      `## Короткие строки (заголовки, подписи). Списки S не связаны с метками A-D.\n\n${shortText}`,
    ].join("\n\n"),
  );
  return { parts, key };
}

export function slot<T>(record: Record<string, T>, key: string, make: () => T): T {
  const existing = record[key];
  if (existing !== undefined) return existing;
  const created = make();
  record[key] = created;
  return created;
}

const emptyScore = (): RunScore => ({
  ok: 0,
  style: 0,
  meaning: 0,
  meaningConfirmed: 0,
  judged: 0,
});

export function scoreRound(
  verdicts: Verdict[],
  key: RoundKey,
  verified: Record<string, boolean>,
): RoundScore {
  const perRun: Record<string, RunScore> = {};
  const pairwise: Record<string, PairScore> = {};
  for (const v of verdicts) {
    const entry = key.items[v.item];
    if (!entry) continue;
    for (const [label, { run, text }] of Object.entries(entry)) {
      const s = slot(perRun, run, emptyScore);
      if (text === null) {
        s.judged++;
        s.meaning++;
        s.meaningConfirmed++;
        continue;
      }
      const given = v.labels[label]?.label;
      if (!given) continue;
      s.judged++;
      s[given]++;
      if (given === "meaning" && verified[`${v.item}:${label}`] === true) s.meaningConfirmed++;
    }
    const labels = Object.keys(entry);
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const [la, lb] = [labels[i] as string, labels[j] as string];
        const [a, b] = [entry[la] as Variant, entry[lb] as Variant];
        let winner: Variant | null = null;
        if (a.text !== b.text) {
          if (a.text === null) winner = b;
          else if (b.text === null) winner = a;
          else {
            const [ia, ib] = [v.ranking.indexOf(la), v.ranking.indexOf(lb)];
            if (ia >= 0 && ib >= 0 && ia !== ib) winner = ia < ib ? a : b;
          }
        }
        const [first, second] = [a.run, b.run].sort() as [string, string];
        const p = slot(pairwise, `${first}|${second}`, () => ({ wins: 0, losses: 0, ties: 0 }));
        if (!winner) p.ties++;
        else if (winner.run === first) p.wins++;
        else p.losses++;
      }
    }
  }
  return { perRun, pairwise };
}

export type CalibrationAnswers = {
  pairs: { item: string; X: string; Y: string; judgeBetter: "X" | "Y" }[];
  labels: { item: string; run: string; judgeLabel: Label }[];
};

export function buildCalibration(
  verdicts: Verdict[],
  key: RoundKey,
  snapshot: Snapshot,
  opts: { pairs: number; labels: number; seed: number },
): { markdown: string; answers: CalibrationAnswers } {
  const rand = random(opts.seed);
  const slotsOf = new Map(snapshot.segments.map((s) => [s.id, { text: s.text, slots: s.slots }]));
  const confident = verdicts.filter((v) => {
    const [top, bottom] = [v.ranking[0], v.ranking.at(-1)];
    const entry = key.items[v.item];
    if (!top || !bottom || top === bottom || !entry) return false;
    const [a, b] = [entry[top], entry[bottom]];
    if (!a?.text || !b?.text || a.text === b.text) return false;
    return v.labels[top]?.label !== v.labels[bottom]?.label;
  });
  const picked = shuffle(confident, rand).slice(0, opts.pairs);
  const answers: CalibrationAnswers = { pairs: [], labels: [] };
  const lines = [
    "# Калибровка судьи",
    "Для каждой пары напиши X, Y или равны. Для одиночных переводов напиши ok (как написано по-русски, смысл точен), style (понятно, но коряво) или meaning (смысл искажен).",
  ];
  picked.forEach((v, n) => {
    const entry = key.items[v.item] as Record<string, Variant>;
    const [top, bottom] = [v.ranking[0] as string, v.ranking.at(-1) as string];
    const swap = rand() < 0.5;
    const [x, y] = swap ? [bottom, top] : [top, bottom];
    const src = slotsOf.get(v.item);
    const slots = src?.slots ?? {};
    answers.pairs.push({
      item: v.item,
      X: entry[x]?.run ?? "",
      Y: entry[y]?.run ?? "",
      judgeBetter: swap ? "Y" : "X",
    });
    lines.push(
      `## Пара ${n + 1}\nSRC: ${renderReader(src?.text ?? "", slots)}\nX: ${show(entry[x]?.text ?? null, slots)}\nY: ${show(entry[y]?.text ?? null, slots)}\nОтвет:`,
    );
  });
  const used = new Set(picked.map((v) => v.item));
  const rest = shuffle(
    verdicts.filter((v) => !used.has(v.item)),
    rand,
  ).slice(0, opts.labels);
  rest.forEach((v, n) => {
    const entry = key.items[v.item] as Record<string, Variant>;
    const labels = Object.keys(entry).filter((l) => entry[l]?.text && v.labels[l]);
    const label = labels[Math.floor(rand() * labels.length)];
    if (!label) return;
    const src = slotsOf.get(v.item);
    const slots = src?.slots ?? {};
    answers.labels.push({
      item: v.item,
      run: entry[label]?.run ?? "",
      judgeLabel: v.labels[label]?.label ?? "ok",
    });
    lines.push(
      `## Перевод ${n + 1}\nSRC: ${renderReader(src?.text ?? "", slots)}\nOUT: ${show(entry[label]?.text ?? null, slots)}\nОтвет:`,
    );
  });
  return { markdown: lines.join("\n\n"), answers };
}
