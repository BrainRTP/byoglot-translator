import type { LintReport, Row, Snapshot } from "./types.ts";

const MARKERS: Record<string, RegExp> = {
  явля: /(?<!\p{L})явля\p{L}*/giu,
  посредством: /(?<!\p{L})посредством/giu,
  фактическ: /(?<!\p{L})фактическ\p{L}*/giu,
  осуществл: /(?<!\p{L})осуществл\p{L}*/giu,
  данный: /(?<!\p{L})данн(?:ый|ая|ое|ого|ой|ому|ом|ую)(?!\p{L})/giu,
  "рассмотрите возможность": /рассмотрите возможность/giu,
  вы: /(?<!\p{L})(?:вы|вам|вас|ваш\p{L}*)(?!\p{L})/giu,
};

type Probe = { source: RegExp; variants: [string, RegExp][] };

const NOT_AFTER = "(?<![\\p{L}-])";
const v = (label: string, stem: string): [string, RegExp] => [
  label,
  new RegExp(`${NOT_AFTER}${stem}`, "iu"),
];

const TERMS: Record<string, Probe> = {
  bean: {
    source: /\bbeans?\b/i,
    variants: [
      v("бин", "бин(?!арн)"),
      v("bean-компонент", "bean-компонент"),
      v("bean", "beans?(?![\\p{L}-])"),
    ],
  },
  resolver: {
    source: /\bresolver\b/i,
    variants: [
      v("резолвер", "резолвер"),
      v("преобразователь", "преобразовател"),
      v("распознаватель", "распознавател"),
      v("разрешитель", "разрешител"),
      v("resolver", "resolver"),
    ],
  },
  wildcard: {
    source: /\bwildcard/i,
    variants: [
      v("подстановочный", "подстановочн"),
      v("маска", "маск"),
      v("шаблон", "шаблон"),
      v("wildcard", "wildcard"),
    ],
  },
  caveats: {
    source: /\bcaveats?\b/i,
    variants: [
      v("особенности", "особенност"),
      v("ограничения", "ограничени"),
      v("предостережения", "предостережени"),
      v("подводные камни", "подводн"),
      v("нюансы", "нюанс"),
      v("caveats", "caveats?"),
    ],
  },
  autowiring: {
    source: /\bautowir/i,
    variants: [
      v("автосвязывание", "автосвязыв"),
      v("автоматическое связывание", "автоматическ\\p{L}* связыв"),
      v("автопривязка", "автопривяз"),
      v("автовайринг", "автовайр"),
      v("autowiring", "autowir"),
    ],
  },
};

const withoutTags = (s: string) => s.replace(/<x\d+\/>/g, " ").replace(/<\/?x\d+>/g, "");
const wordsOf = (s: string) => s.match(/[\p{L}\p{N}]+/gu) ?? [];

function englishRuns(text: string, allowed: Set<string>): string[] {
  const clean = text.replace(/https?:\/\/\S+|www\.\S+|\S+\.(?:com|org|io|net)\S*/gi, " ");
  const runs = clean.match(/(?<!\p{L})[A-Za-z][A-Za-z'-]*(?: +[A-Za-z][A-Za-z'-]*)+/gu) ?? [];
  return runs.filter((run) => !run.split(/ +/).every((w) => allowed.has(w.toLowerCase())));
}

export function lint(rows: Row[], snapshot: Snapshot): LintReport {
  const done = rows.filter((r): r is Row & { translation: string } => r.translation !== null);
  const texts = done.map((r) => withoutTags(r.translation));
  const all = texts.join("\n");
  const words = wordsOf(all).length;

  const markersPer1000: Record<string, number> = {};
  for (const [name, re] of Object.entries(MARKERS)) {
    const count = all.match(re)?.length ?? 0;
    markersPer1000[name] = words === 0 ? 0 : Math.round((count / words) * 10000) / 10;
  }

  const allowed = new Set(wordsOf(snapshot.title).map((w) => w.toLowerCase()));
  const englishLeft = done.flatMap((r) =>
    englishRuns(withoutTags(r.translation), allowed).map((phrase) => ({ id: r.id, phrase })),
  );

  const sentences = texts.flatMap((t) => t.split(/(?<=[.!?…])\s+/)).map((s) => wordsOf(s).length);
  const nonEmpty = sentences.filter((n) => n > 0);

  const termVariants: Record<string, string[]> = {};
  for (const [term, probe] of Object.entries(TERMS)) {
    const found = new Set<string>();
    for (const r of done) {
      if (!probe.source.test(withoutTags(r.source))) continue;
      for (const [label, re] of probe.variants)
        if (re.test(withoutTags(r.translation))) found.add(label);
    }
    if (found.size > 0) termVariants[term] = [...found];
  }

  return {
    finalFailed: rows.filter((r) => r.translation === null).map((r) => r.id),
    englishLeft,
    words,
    markersPer1000,
    yoCount: all.match(/[\u0451\u0401]/g)?.length ?? 0,
    avgSentenceWords: nonEmpty.length
      ? Math.round((nonEmpty.reduce((a, b) => a + b, 0) / nonEmpty.length) * 10) / 10
      : 0,
    maxSentenceWords: nonEmpty.length ? Math.max(...nonEmpty) : 0,
    termVariants,
  };
}
