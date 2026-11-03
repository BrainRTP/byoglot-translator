import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { build } from "vite";
import { DATA, QUALITY, ROOT } from "./lib/paths.ts";
import type { Segment, Selection, Snapshot } from "./lib/types.ts";

type Entry = {
  id: string;
  url: string;
  scope: string | null;
  sourceLang: string;
  limitChars?: number;
  selections: { id: string; find: string }[];
};

const MAX_CONTEXT = 1000;

async function bundleExtractor(): Promise<string> {
  const outDir = join(DATA, "build");
  await build({
    configFile: false,
    logLevel: "warn",
    publicDir: false,
    build: {
      outDir,
      emptyOutDir: true,
      minify: false,
      lib: {
        entry: join(ROOT, "lib/dom/extract.ts"),
        formats: ["iife"],
        name: "OCT",
        fileName: () => "extract.js",
      },
    },
  });
  return readFileSync(join(outDir, "extract.js"), "utf8");
}

const corpus = JSON.parse(readFileSync(join(QUALITY, "corpus.json"), "utf8")) as Entry[];
const wanted = process.argv[2] ?? "all";
const entries = wanted === "all" ? corpus : corpus.filter((e) => e.id === wanted);
if (entries.length === 0) throw new Error(`unknown corpus id ${wanted}`);

const extractor = await bundleExtractor();
const browser = await chromium.launch();
const context = await browser.newContext({ bypassCSP: true });
mkdirSync(join(DATA, "corpus"), { recursive: true });
for (const entry of entries) {
  const page = await context.newPage();
  await page.goto(entry.url, { waitUntil: "load", timeout: 60_000 });
  await page.waitForTimeout(1500);
  await page.addScriptTag({ content: extractor });
  const data = await page.evaluate(
    ({ scope, selections, maxContext }) => {
      type Slot = { n: number; node: Element; selfClosing: boolean };
      type Block = { id: string; source: string; slots: Slot[] };
      const oct = (window as unknown as { OCT: { extractBlocks(root: Node, o: object): Block[] } })
        .OCT;
      const root = scope ? document.querySelector(scope) : document;
      if (!root) throw new Error(`scope ${scope} not found`);
      let n = 0;
      const blocks = oct.extractBlocks(root, {
        isTranslated: () => false,
        nextId: () => `b${++n}`,
      });
      const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
      const center = (block: string, selected: string) => {
        if (block.length <= maxContext) return block;
        const idx = Math.max(0, block.indexOf(collapse(selected)));
        const start = Math.min(
          Math.max(0, idx + Math.floor(selected.length / 2) - Math.floor(maxContext / 2)),
          block.length - maxContext,
        );
        return block.slice(start, start + maxContext);
      };
      const candidates = Array.from(
        document.querySelectorAll("p,li,td,th,dd,dt,h1,h2,h3,h4,h5,h6,blockquote,figcaption"),
      );
      return {
        title: document.title,
        hostname: location.hostname,
        segments: blocks.map((b) => ({
          id: b.id,
          text: b.source,
          slots: Object.fromEntries(
            b.slots
              .filter((s) => s.selfClosing)
              .map((s) => [String(s.n), s.node.textContent ?? ""]),
          ),
        })),
        selections: selections.map((sel) => {
          const holders = candidates
            .filter((el) => collapse(el.textContent ?? "").includes(sel.find))
            .sort((a, b) => (a.textContent ?? "").length - (b.textContent ?? "").length);
          const block = collapse(holders[0]?.textContent ?? "");
          if (!block) throw new Error(`selection ${sel.id} not found`);
          return { id: sel.id, text: sel.find, context: center(block, sel.find) };
        }),
      };
    },
    { scope: entry.scope, selections: entry.selections, maxContext: MAX_CONTEXT },
  );
  await page.close();
  const limit = entry.limitChars ?? Number.POSITIVE_INFINITY;
  const segments: Segment[] = [];
  let used = 0;
  for (const s of data.segments as Segment[]) {
    if (used >= limit) break;
    segments.push(s);
    used += s.text.length;
  }
  const path = join(DATA, "corpus", `${entry.id}.json`);
  if (existsSync(path) && !process.argv.includes("--force")) {
    const kept = (JSON.parse(readFileSync(path, "utf8")) as Snapshot).segments;
    const same = JSON.stringify(kept) === JSON.stringify(segments);
    if (!same)
      console.log(
        `${entry.id}: page changed, keeping the old segments (use --force to replace them)`,
      );
    segments.splice(0, segments.length, ...kept);
  }
  const snapshot: Snapshot = {
    id: entry.id,
    url: entry.url,
    sourceLang: entry.sourceLang,
    takenAt: new Date().toISOString(),
    title: data.title,
    hostname: data.hostname,
    segments,
    selections: data.selections as Selection[],
  };
  writeFileSync(path, JSON.stringify(snapshot, null, 1));
  const chars = snapshot.segments.reduce((a, s) => a + s.text.length, 0);
  console.log(
    `${entry.id}: segments=${snapshot.segments.length} chars=${chars} selections=${snapshot.selections.length}`,
  );
}
await browser.close();

const merged: Selection[] = corpus.flatMap((e) => {
  const path = join(DATA, "corpus", `${e.id}.json`);
  if (!existsSync(path)) return [];
  const snap = JSON.parse(readFileSync(path, "utf8")) as Snapshot;
  return snap.selections.map((sel) => ({ ...sel, hostname: snap.hostname }));
});
const all: Snapshot = {
  id: "selections",
  url: "(several pages)",
  title: "Selections",
  hostname: "various",
  sourceLang: "en",
  takenAt: new Date().toISOString(),
  segments: [],
  selections: merged,
};
writeFileSync(join(DATA, "corpus", "selections.json"), JSON.stringify(all, null, 1));
console.log(`selections: ${merged.length} from all snapshots`);
