import type { ConnectionKind } from "../connections/types";
import { applyBilingual, applyReplace, createJournal } from "../dom/apply";
import { MARK_ATTR } from "../dom/constants";
import type { Block } from "../dom/extract";
import type { PortLike } from "../dom/page-translator";
import { selectionBlocks } from "../dom/selection-blocks";
import { t } from "../i18n";
import type { PortToContent } from "../messaging/page-port";
import type { BackendErrorKind } from "../opencode/types";
import type { DisplayMode, ThemeChoice } from "../settings/types";
import { applyTheme } from "../ui/theme";
import { svgIcon } from "./card";
import { STYLES } from "./styles";

export type InsertOutcome =
  | "done"
  | "empty"
  | { error: BackendErrorKind; retryAfterMs?: number; backend?: ConnectionKind };

export type InserterDeps = {
  doc: Document;
  connect(): PortLike;
  getDisplayMode(): Promise<DisplayMode>;
  theme?(): Promise<ThemeChoice>;
};

type Insertion = { restore(): void };

const REVERT_ICON = ["M9 14 4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"];
const HOST_CSS = "display:inline-block;position:relative;width:0;height:0;vertical-align:top";

export function createSelectionInserter(deps: InserterDeps) {
  const { doc } = deps;
  const live = new Set<Insertion>();
  let counter = 0;

  async function insert(range: Range): Promise<InsertOutcome> {
    const blocks = selectionBlocks(range, () => `s${++counter}`);
    if (blocks.length === 0) return "empty";
    doc.getSelection()?.removeAllRanges();
    const mode = await deps.getDisplayMode();
    const last = blocks[blocks.length - 1] as Block;
    const lastText = last.textNodes[last.textNodes.length - 1] as Text;

    const journal = createJournal();
    const byId = new Map(blocks.map((b) => [b.id, b]));
    const spans = new Map<Block, Element>();
    let applied = 0;

    const host = doc.createElement("span");
    host.setAttribute(MARK_ATTR, "revert");
    host.setAttribute("style", HOST_CSS);
    const shadow = host.attachShadow({ mode: "closed" });
    const style = doc.createElement("style");
    style.textContent = STYLES;
    const root = doc.createElement("div");
    root.className = "root";
    shadow.append(style, root);
    void deps
      .theme?.()
      .then((choice) => applyTheme(root, choice))
      .catch(() => {});
    const spinner = doc.createElement("span");
    spinner.className = "revert";
    spinner.append(Object.assign(doc.createElement("span"), { className: "spin" }));
    root.append(spinner);

    const mount = () => {
      const lastSpan = spans.get(last);
      (lastSpan ?? lastText).after(host);
    };
    mount();

    const insertion: Insertion = {
      restore() {
        journal.restoreAll();
        host.remove();
        live.delete(insertion);
      },
    };
    live.add(insertion);

    const port = deps.connect();
    return new Promise<InsertOutcome>((resolve) => {
      let jobId = "";
      let settled = false;
      const finish = (outcome: InsertOutcome) => {
        settled = true;
        try {
          port.disconnect();
        } catch {}
        if (outcome !== "done") insertion.restore();
        resolve(outcome);
      };
      port.onMessage.addListener((m: PortToContent) => {
        if (settled || m.jobId !== jobId) return;
        // restoreAll ran while the job was in flight, late results must not write again
        if (!live.has(insertion)) {
          finish("empty");
          return;
        }
        if (m.type === "results") {
          host.remove();
          for (const r of m.results) {
            const block = byId.get(r.id);
            if (!block || r.text.trim() === "" || journal.hasBlock(block)) continue;
            try {
              if (mode === "bilingual")
                spans.set(block, applyBilingual(block, r.text, journal, true));
              else applyReplace(block, r.text, journal);
              applied++;
            } catch {}
          }
          mount();
        } else if (m.type === "fatal") {
          finish({
            error: m.kind,
            ...(m.retryAfterMs !== undefined && { retryAfterMs: m.retryAfterMs }),
            ...(m.backend !== undefined && { backend: m.backend }),
          });
        } else if (m.type === "done") {
          if (applied === 0) {
            finish({ error: "bad_response" });
            return;
          }
          const label = t("selection.revert");
          const btn = doc.createElement("button");
          btn.type = "button";
          btn.className = "revert";
          btn.setAttribute("aria-label", label);
          btn.title = label;
          btn.append(svgIcon(doc, 14, REVERT_ICON));
          btn.addEventListener("mousedown", (e) => e.preventDefault());
          btn.addEventListener("click", () => insertion.restore());
          spinner.replaceWith(btn);
          finish("done");
        }
      });
      port.onDisconnect?.addListener(() => {
        if (!settled) finish({ error: "offline" });
      });
      jobId = crypto.randomUUID();
      try {
        port.postMessage({
          type: "translate",
          jobId,
          segments: blocks.map((b) => ({ id: b.id, text: b.source })),
          page: { title: doc.title, hostname: doc.location?.hostname ?? "" },
        });
      } catch {
        finish({ error: "offline" });
      }
    });
  }

  return {
    insert,
    restoreAll() {
      for (const i of [...live]) i.restore();
    },
  };
}
