import type { PortToBackground, PortToContent } from "../messaging/page-port";
import type { PageState } from "../messaging/protocol";
import type { DisplayMode } from "../settings/types";
import { applyBilingual, applyReplace, createJournal, parseTranslated } from "./apply";
import { BLOCK_ID_ATTR, BLOCK_SELECTOR, BLOCK_TAGS } from "./constants";
import { type Block, extractBlocks } from "./extract";
import { createLanes, type Lane } from "./lanes";
import { findMainRoot, laneOf, orderByPosition } from "./layout";
import {
  type Changes,
  classify,
  containerOf,
  createWatcher,
  insideMark,
  newChanges,
  type Watcher,
} from "./observer";
import { createVisibility, prioritize, type Visibility } from "./visibility";

export type PortLike = {
  postMessage(m: PortToBackground): void;
  onMessage: { addListener(f: (m: PortToContent) => void): void };
  onDisconnect?: { addListener(f: () => void): void };
  disconnect(): void;
};

export type PageTranslatorDeps = {
  doc: Document;
  connect(): PortLike;
  getDisplayMode(): Promise<DisplayMode>;
  detectLanguage(text: string): Promise<{ lang: string; reliable: boolean }>;
  targetLang(): Promise<string>;
  onState(s: PageState): void;
};

export type PageTranslator = {
  start(): Promise<void>;
  stop(): void;
  restore(): void;
  state(): PageState;
};

const FIRST_MAIN_CHUNK = 10;
const CHUNK_SIZE = 50;
const MAX_JOBS = 2;
const DEBOUNCE_MS = 300;
const MAX_FLUSH_FAILURES = 3;
const DETECT_MIN_LENGTH = 20;
const DETECT_GROUP = 100;
const LOOP_MAX = 2;
const LOOP_WINDOW_MS = 10_000;
const PLACEHOLDER = /<\/?x\d+\/?>/g;

type Status = "queued" | "inflight" | "applied" | "failed";
type Job = { blocks: Map<string, Block>; lane: Lane };

const primary = (lang: string) => (lang.split(/[-_]/)[0] ?? "").toLowerCase();
const rectOf = (el: Element) => el.getBoundingClientRect();

export function createPageTranslator(deps: PageTranslatorDeps): PageTranslator {
  const journal = createJournal();
  const status = new Map<Block, Status>();
  const handled = new Set<Element>();
  const jobs = new Map<string, Job>();
  const retranslations = new WeakMap<Element, number[]>();
  const knownTexts = new WeakMap<Element, Set<string>>();
  const lanes = createLanes<Block>({ firstMainChunk: FIRST_MAIN_CHUNK, chunk: CHUNK_SIZE });
  let mainRoot: Element | null = null;
  let port: PortLike | null = null;
  let watcher: Watcher | null = null;
  let visibility: Visibility | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let flushChain: Promise<void> = Promise.resolve();
  let changes: Changes = newChanges();
  let phase: PageState["state"] = "idle";
  let failure: PageState["error"];
  let displayMode: DisplayMode = "replace";
  let target = "";
  let gen = 0;
  let preparing = 0;
  let counter = 0;
  let published: string | null = null;
  let flushFailures = 0;

  const nextId = () => `b${++counter}`;
  const busy = () => jobs.size > 0 || lanes.size() > 0 || preparing > 0;

  function snapshot(): PageState {
    let done = 0;
    let failed = 0;
    for (const s of status.values()) {
      if (s === "applied") done++;
      else if (s === "failed") failed++;
    }
    const result: PageState = { state: phase, done, total: status.size, failed };
    if (phase === "error" && failure) result.error = failure;
    return result;
  }

  function publish() {
    const s = snapshot();
    const key = JSON.stringify(s);
    if (key === published) return;
    published = key;
    deps.onState(s);
  }

  function settle() {
    if (phase === "translating" && !busy()) phase = "translated";
    publish();
  }

  function appliedCount(): number {
    let n = 0;
    for (const s of status.values()) if (s === "applied") n++;
    return n;
  }

  function isOwn(node: Text): boolean {
    if (journal.isOwnValue(node)) return true;
    const container = containerOf(node);
    return container ? (knownTexts.get(container)?.has(node.data.trim()) ?? false) : false;
  }

  function absorb() {
    if (!watcher) return;
    classify(watcher.takeRecords(), isOwn, changes);
    if (changes.dirty.size > 0 || changes.added.size > 0 || changes.removed.size > 0) schedule();
  }

  function quiet(fn: () => void) {
    absorb();
    fn();
    watcher?.takeRecords();
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      flushChain = flushChain.then(flush, flush);
    }, DEBOUNCE_MS);
  }

  function ensurePort(): PortLike {
    if (!port) {
      const opened = deps.connect();
      port = opened;
      opened.onMessage.addListener(onPortMessage);
      opened.onDisconnect?.addListener(() => onPortLost(opened));
    }
    return port;
  }

  function closePort() {
    try {
      port?.disconnect();
    } catch {}
    port = null;
  }

  function ensureVisibility(): Visibility {
    visibility ??= createVisibility({
      onVisible: (visible) => {
        lanes.reorder((items) => prioritize(items, visible));
      },
    });
    return visibility;
  }

  async function wantsTranslation(block: Block): Promise<boolean> {
    const text = block.source.replace(PLACEHOLDER, "").trim();
    if (text.length < DETECT_MIN_LENGTH) return true;
    try {
      const detected = await deps.detectLanguage(text);
      return !(detected.reliable && primary(detected.lang) === primary(target));
    } catch {
      return true;
    }
  }

  async function accept(blocks: Block[]): Promise<Block[]> {
    const accepted: Block[] = [];
    for (let i = 0; i < blocks.length; i += DETECT_GROUP) {
      const group = blocks.slice(i, i + DETECT_GROUP);
      const keep = await Promise.all(group.map(wantsTranslation));
      group.forEach((block, j) => {
        if (keep[j]) accepted.push(block);
      });
    }
    return accepted;
  }

  function isRtl(): boolean {
    const html = deps.doc.documentElement;
    return html.dir === "rtl" || deps.doc.defaultView?.getComputedStyle(html).direction === "rtl";
  }

  function currentMainRoot(fresh: Block[]): Element | null {
    if (mainRoot && !mainRoot.isConnected) {
      mainRoot = findMainRoot(
        deps.doc,
        [...status.keys(), ...fresh],
        rectOf,
        deps.doc.defaultView?.innerWidth ?? 0,
      );
    }
    return mainRoot;
  }

  function inflightByLane(): Record<Lane, number> {
    const count: Record<Lane, number> = { main: 0, side: 0 };
    for (const job of jobs.values()) count[job.lane]++;
    return count;
  }

  async function enqueue(blocks: Block[], myGen: number) {
    const accepted = await accept(blocks);
    if (myGen !== gen) return;
    const vis = ensureVisibility();
    const root = currentMainRoot(accepted);
    for (const block of accepted) {
      status.set(block, "queued");
      lanes.push(block, laneOf(root, block.element));
    }
    vis.watch(accepted.map((b) => b.element));
    pump();
    publish();
  }

  function pump() {
    while (phase === "translating" && jobs.size < MAX_JOBS) {
      const next = lanes.take(inflightByLane());
      if (!next) break;
      const chunk = next.items;
      const jobId = crypto.randomUUID();
      jobs.set(jobId, { blocks: new Map(chunk.map((b) => [b.id, b])), lane: next.lane });
      for (const block of chunk) status.set(block, "inflight");
      try {
        ensurePort().postMessage({
          type: "translate",
          jobId,
          segments: chunk.map((b) => ({ id: b.id, text: b.source })),
          page: { title: deps.doc.title, hostname: deps.doc.location?.hostname ?? "" },
        });
      } catch {
        jobs.delete(jobId);
        for (const block of chunk) status.set(block, "failed");
        port = null;
      }
    }
  }

  function remember(block: Block, text: string) {
    const plain = parseTranslated(text)
      .map((t) => (t.type === "text" ? t.value : ""))
      .join("")
      .trim();
    const set = knownTexts.get(block.element) ?? new Set<string>();
    set.add(plain);
    knownTexts.set(block.element, set);
  }

  function applyResults(job: Job, results: Extract<PortToContent, { type: "results" }>["results"]) {
    quiet(() => {
      for (const result of results) {
        const block = job.blocks.get(result.id);
        if (!block || status.get(block) !== "inflight") continue;
        if (result.text.trim() === "") {
          status.set(block, "failed");
          continue;
        }
        try {
          if (displayMode === "bilingual") applyBilingual(block, result.text, journal);
          else applyReplace(block, result.text, journal);
          status.set(block, "applied");
          remember(block, result.text);
        } catch {
          status.set(block, "failed");
        }
      }
    });
  }

  function onPortLost(lost: PortLike) {
    if (port !== lost) return;
    port = null;
    if (jobs.size === 0) return;
    abandon();
    failure = { kind: "offline" };
    phase = "error";
    publish();
  }

  function onPortMessage(message: PortToContent) {
    const job = jobs.get(message.jobId);
    if (!job) return;
    switch (message.type) {
      case "results":
        applyResults(job, message.results);
        publish();
        break;
      case "failed":
        for (const id of message.ids) {
          const block = job.blocks.get(id);
          if (block && status.get(block) === "inflight") status.set(block, "failed");
        }
        publish();
        break;
      case "fatal":
        failure = { kind: message.kind };
        if (message.retryAfterMs !== undefined) failure.retryAfterMs = message.retryAfterMs;
        abandon();
        phase = "error";
        publish();
        break;
      case "done":
        jobs.delete(message.jobId);
        for (const block of job.blocks.values()) {
          if (status.get(block) === "inflight") status.set(block, "failed");
        }
        pump();
        if (jobs.size === 0 && !watcher) closePort();
        settle();
        break;
    }
  }

  function abandon() {
    gen++;
    clearTimeout(timer);
    changes = newChanges();
    for (const jobId of jobs.keys()) {
      try {
        port?.postMessage({ type: "abort", jobId });
      } catch {}
    }
    jobs.clear();
    lanes.clear();
    for (const [block, s] of [...status]) {
      if (s === "queued" || s === "inflight") status.delete(block);
    }
    watcher?.disconnect();
    watcher = null;
    visibility?.disconnect();
    visibility = null;
    closePort();
  }

  function restoreKeepingPage(block: Block) {
    const keep = block.textNodes
      .filter((t) => t.isConnected && !journal.isOwnValue(t))
      .map((t) => [t, t.nodeValue] as const);
    journal.restoreBlock(block);
    for (const [node, value] of keep) if (node.nodeValue !== value) node.nodeValue = value;
  }

  function release(container: Element): boolean {
    let had = false;
    quiet(() => {
      for (const block of [...status.keys()]) {
        if (block.element !== container) continue;
        had = true;
        if (journal.hasBlock(block)) restoreKeepingPage(block);
        status.delete(block);
      }
    });
    lanes.filter((b) => b.element !== container);
    return had;
  }

  function forgetDetached() {
    const gone: Element[] = [];
    for (const block of [...status.keys()]) {
      if (block.element.isConnected) continue;
      journal.restoreBlock(block);
      status.delete(block);
      gone.push(block.element);
    }
    for (const el of gone) retranslations.delete(el);
    for (const el of handled) if (!el.isConnected) handled.delete(el);
    lanes.filter((b) => b.element.isConnected);
    visibility?.unwatch(gone);
  }

  function recentRetranslations(container: Element): number[] {
    const now = Date.now();
    const recent = (retranslations.get(container) ?? []).filter((t) => now - t < LOOP_WINDOW_MS);
    retranslations.set(container, recent);
    return recent;
  }

  function extract(root: Element | Document, into: Block[]) {
    const blocks = extractBlocks(root, {
      isTranslated: (el) => handled.has(el),
      nextId,
    });
    for (const block of blocks) handled.add(block.element);
    into.push(...blocks);
    watcher?.observeShadowRoots(root);
  }

  async function flush() {
    if (!watcher) return;
    const myGen = gen;
    absorb();
    clearTimeout(timer);
    const taken = changes;
    changes = newChanges();
    const found: Block[] = [];
    try {
      await processChanges(taken, found, myGen);
      flushFailures = 0;
    } catch {
      if (myGen !== gen) return;
      for (const block of found) if (!status.has(block)) handled.delete(block.element);
      if (++flushFailures >= MAX_FLUSH_FAILURES) {
        flushFailures = 0;
        settle();
        return;
      }
      for (const el of taken.dirty) changes.dirty.add(el);
      for (const el of taken.added) changes.added.add(el);
      for (const el of taken.removed) changes.removed.add(el);
      schedule();
    }
  }

  async function processChanges({ dirty, added, removed }: Changes, found: Block[], myGen: number) {
    if (removed.size > 0) forgetDetached();
    const roots: Element[] = [];
    for (const el of added) {
      if (!el.isConnected || insideMark(el)) continue;
      const container = containerOf(el);
      const isBlock = BLOCK_TAGS.has(el.localName) || el.querySelector(BLOCK_SELECTOR) !== null;
      if (!isBlock && container) dirty.add(container);
      else roots.push(el);
    }

    for (const container of dirty) {
      if (!container.isConnected) {
        release(container);
        handled.delete(container);
        continue;
      }
      if (insideMark(container)) continue;
      const had = release(container);
      handled.delete(container);
      if (recentRetranslations(container).length >= LOOP_MAX) {
        handled.add(container);
        continue;
      }
      if (had) recentRetranslations(container).push(Date.now());
      extract(container, found);
    }
    for (const root of roots) extract(root, found);

    if (found.length === 0) {
      settle();
      return;
    }
    phase = "translating";
    preparing++;
    publish();
    try {
      await enqueue(found, myGen);
    } finally {
      preparing--;
    }
    if (myGen === gen) settle();
  }

  function teardown() {
    abandon();
    journal.restoreAll();
    for (const el of deps.doc.querySelectorAll(`[${BLOCK_ID_ATTR}]`)) {
      el.removeAttribute(BLOCK_ID_ATTR);
    }
    status.clear();
    handled.clear();
    mainRoot = null;
    failure = undefined;
  }

  async function start(): Promise<void> {
    if (phase === "translating") return;
    teardown();
    const myGen = gen;
    phase = "translating";
    preparing++;
    publish();
    try {
      const [mode, lang] = await Promise.all([deps.getDisplayMode(), deps.targetLang()]);
      if (myGen !== gen) return;
      displayMode = mode;
      target = lang;
      const blocks: Block[] = [];
      extract(deps.doc, blocks);
      watcher = createWatcher((records) => {
        classify(records, isOwn, changes);
        schedule();
      });
      watcher.observe(deps.doc);
      watcher.observeShadowRoots(deps.doc);
      mainRoot = findMainRoot(deps.doc, blocks, rectOf, deps.doc.defaultView?.innerWidth ?? 0);
      const visible = await ensureVisibility().initial(blocks.map((b) => b.element));
      if (myGen !== gen) return;
      await enqueue(prioritize(orderByPosition(blocks, rectOf, isRtl()), visible), myGen);
    } catch {
      if (myGen !== gen) return;
      abandon();
      failure = { kind: "offline" };
      phase = "error";
    } finally {
      preparing--;
      if (myGen === gen) settle();
    }
  }

  function stop() {
    if (phase === "idle") return;
    abandon();
    phase = appliedCount() > 0 ? "translated" : "idle";
    failure = undefined;
    publish();
  }

  function restore() {
    teardown();
    phase = "idle";
    publish();
  }

  return { start, stop, restore, state: snapshot };
}

export function shareInFlight<T>(fn: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    pending ??= fn().finally(() => {
      pending = null;
    });
    return pending;
  };
}
