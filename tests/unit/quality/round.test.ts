import { describe, expect, it } from "vitest";
import { buildCalibration, buildRound, scoreRound, type Verdict } from "../../quality/lib/round.ts";
import type { RunConfig, RunResult, Snapshot } from "../../quality/lib/types.ts";

const long = (n: number) =>
  `Source sentence number ${n} that is long enough to be judged by the judge.`;
const snapshot: Snapshot = {
  id: "t",
  url: "https://example.com/page",
  title: "Page",
  hostname: "example.com",
  sourceLang: "en",
  takenAt: "2026-11-03",
  segments: Array.from({ length: 20 }, (_, i) => ({
    id: `b${i + 1}`,
    text: long(i + 1),
    slots: {},
  })),
  selections: [],
};
const run = (runId: string, translate: (id: string) => string | null): RunResult => ({
  runId,
  config: {} as RunConfig,
  rows: snapshot.segments.map((s) => ({ id: s.id, source: s.text, translation: translate(s.id) })),
  stats: {
    calls: 0,
    transportErrors: 0,
    firstPassFailed: [],
    finalFailed: [],
    firstBatchMs: 0,
    totalMs: 0,
  },
});
const alpha = run("run-alpha-secret", (id) => `перевод альфа ${id}`);
const beta = run("run-beta-secret", (id) => `перевод бета ${id}`);
const opts = { roundId: "r1", parts: 2, seed: 7 };

const labelOf = (key: ReturnType<typeof buildRound>["key"], item: string, runId: string) =>
  Object.entries(key.items[item] ?? {}).find(([, v]) => v.run === runId)?.[0] ?? "";

describe("buildRound", () => {
  it("maps every label back to its run and shuffles labels across items", () => {
    const { key } = buildRound([alpha, beta], snapshot, opts);
    const items = Object.keys(key.items);
    expect(items).toHaveLength(20);
    for (const item of items) {
      expect(
        Object.values(key.items[item] ?? {})
          .map((v) => v.run)
          .sort(),
      ).toEqual(["run-alpha-secret", "run-beta-secret"]);
    }
    const firstA = new Set(items.map((item) => key.items[item]?.A?.run));
    expect(firstA.size).toBe(2);
  });

  it("keeps run names out of the judge files and splits items into parts", () => {
    const { parts } = buildRound([alpha, beta], snapshot, opts);
    expect(parts).toHaveLength(2);
    for (const part of parts) expect(part).not.toMatch(/secret|alpha|beta/);
  });

  it("shows a missing translation as such", () => {
    const broken = run("run-broken", (id) => (id === "b1" ? null : `текст ${id}`));
    const { parts } = buildRound([alpha, broken], snapshot, opts);
    expect(parts.join("\n")).toContain("(нет перевода)");
  });
});

describe("scoreRound", () => {
  const verdictFor = (
    key: ReturnType<typeof buildRound>["key"],
    item: string,
    order: string[],
    labels: Record<string, "ok" | "style" | "meaning">,
  ): Verdict => ({
    item,
    ranking: order.map((r) => labelOf(key, item, r)),
    labels: Object.fromEntries(
      Object.entries(labels).map(([r, label]) => [labelOf(key, item, r), { label, note: "" }]),
    ),
  });

  it("counts wins by ranking and labels per run", () => {
    const { key } = buildRound([alpha, beta], snapshot, opts);
    const verdicts = [
      verdictFor(key, "b1", ["run-alpha-secret", "run-beta-secret"], {
        "run-alpha-secret": "ok",
        "run-beta-secret": "style",
      }),
    ];
    const score = scoreRound(verdicts, key, {});
    expect(score.pairwise["run-alpha-secret|run-beta-secret"]).toEqual({
      wins: 1,
      losses: 0,
      ties: 0,
    });
    expect(score.perRun["run-alpha-secret"]).toMatchObject({ ok: 1, style: 0, judged: 1 });
  });

  it("treats identical translations as a tie whatever the ranking", () => {
    const twin = run("run-twin", (id) => `перевод альфа ${id}`);
    const { key } = buildRound([alpha, twin], snapshot, opts);
    const verdicts = [
      verdictFor(key, "b2", ["run-twin", "run-alpha-secret"], {
        "run-twin": "ok",
        "run-alpha-secret": "ok",
      }),
    ];
    expect(scoreRound(verdicts, key, {}).pairwise["run-alpha-secret|run-twin"]).toEqual({
      wins: 0,
      losses: 0,
      ties: 1,
    });
  });

  it("counts a missing translation as a confirmed meaning error and a loss", () => {
    const broken = run("run-broken", (id) => (id === "b1" ? null : `текст ${id}`));
    const { key } = buildRound([alpha, broken], snapshot, opts);
    const verdicts = [
      verdictFor(key, "b1", ["run-broken", "run-alpha-secret"], {
        "run-broken": "ok",
        "run-alpha-secret": "ok",
      }),
    ];
    const score = scoreRound(verdicts, key, {});
    expect(score.perRun["run-broken"]).toMatchObject({ meaning: 1, meaningConfirmed: 1 });
    expect(score.pairwise["run-alpha-secret|run-broken"]).toEqual({ wins: 1, losses: 0, ties: 0 });
  });

  it("counts only verified meaning flags as confirmed", () => {
    const { key } = buildRound([alpha, beta], snapshot, opts);
    const verdicts = [
      verdictFor(key, "b3", ["run-alpha-secret", "run-beta-secret"], {
        "run-alpha-secret": "ok",
        "run-beta-secret": "meaning",
      }),
      verdictFor(key, "b4", ["run-alpha-secret", "run-beta-secret"], {
        "run-alpha-secret": "ok",
        "run-beta-secret": "meaning",
      }),
    ];
    const verified = {
      [`b3:${labelOf(key, "b3", "run-beta-secret")}`]: true,
      [`b4:${labelOf(key, "b4", "run-beta-secret")}`]: false,
    };
    expect(scoreRound(verdicts, key, verified).perRun["run-beta-secret"]).toMatchObject({
      meaning: 2,
      meaningConfirmed: 1,
    });
  });
});

describe("buildCalibration", () => {
  it("picks pairs only where the judge gave the two translations different labels", () => {
    const { key } = buildRound([alpha, beta], snapshot, opts);
    const items = Object.keys(key.items);
    const verdicts: Verdict[] = items.map((item, i) => ({
      item,
      ranking: ["A", "B"],
      labels: { A: { label: "ok", note: "" }, B: { label: i < 3 ? "style" : "ok", note: "" } },
    }));
    const cal = buildCalibration(verdicts, key, snapshot, { pairs: 10, labels: 5, seed: 1 });
    expect(cal.answers.pairs.map((p) => p.item).sort()).toEqual(items.slice(0, 3).sort());
    expect(cal.markdown).not.toMatch(/secret/);
  });
});

describe("buildRound for selections", () => {
  const selSnap: Snapshot = {
    ...snapshot,
    id: "sel",
    segments: [],
    selections: [
      {
        id: "s-term",
        text: "cruft",
        context: "Software systems are prone to the build up of cruft.",
      },
      { id: "s-sentence", text: long(1), context: "A paragraph around it." },
    ],
  };
  const selRun = (runId: string) => ({
    ...run(runId, () => null),
    rows: selSnap.selections.map((s) => ({
      id: s.id,
      source: s.text,
      translation: `${runId} ${s.id}`,
    })),
  });

  it("judges every selection, short terms included, and shows the context", () => {
    const { parts, key } = buildRound([selRun("x-run"), selRun("y-run")], selSnap, opts);
    expect(Object.keys(key.items).sort()).toEqual(["s-sentence", "s-term"]);
    expect(parts.join("\n")).toContain("CTX: Software systems are prone to the build up of cruft.");
  });
});
