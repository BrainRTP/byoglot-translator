export type Segment = { id: string; text: string; slots: Record<string, string> };

export type Selection = { id: string; text: string; context: string; hostname?: string };

export type Snapshot = {
  id: string;
  url: string;
  title: string;
  hostname: string;
  sourceLang: string;
  takenAt: string;
  segments: Segment[];
  selections: Selection[];
};

export type Effort = "none" | "low" | "high" | "max";

export type RunConfig = {
  snapshot: string;
  mode: "page" | "selection";
  frame: string;
  languagePrompt: string | null;
  template: string;
  effort: Effort;
  targetLang: string;
  codeMode: "hidden" | "visible";
  glossary: string | null;
  maxBlocks: number;
  maxChars: number;
};

export type Row = { id: string; source: string; translation: string | null };

export type RunStats = {
  calls: number;
  transportErrors: number;
  firstPassFailed: string[];
  finalFailed: string[];
  firstBatchMs: number;
  totalMs: number;
  glossaryMs?: number;
  hiddenFallbacks?: number;
};

export type RunResult = { runId: string; config: RunConfig; rows: Row[]; stats: RunStats };

export type LintReport = {
  finalFailed: string[];
  englishLeft: { id: string; phrase: string }[];
  words: number;
  markersPer1000: Record<string, number>;
  yoCount: number;
  avgSentenceWords: number;
  maxSentenceWords: number;
  termVariants: Record<string, string[]>;
};
