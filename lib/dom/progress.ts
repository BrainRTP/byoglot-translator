import type { PageState } from "../messaging/protocol";

export type BarView = {
  visible: boolean;
  fraction: number;
  tone: "run" | "paused";
  finishing: boolean;
};

export function nextBarView(state: PageState, prev: BarView | null): BarView {
  const ratio = state.total > 0 ? state.done / state.total : 0;
  switch (state.state) {
    case "translating":
      return {
        visible: true,
        fraction: Math.max(prev?.fraction ?? 0, ratio),
        tone: "run",
        finishing: false,
      };
    case "translated":
      return { visible: true, fraction: 1, tone: "run", finishing: true };
    case "error":
      return { visible: true, fraction: prev?.fraction ?? ratio, tone: "paused", finishing: false };
    case "idle":
      return { visible: false, fraction: 0, tone: "run", finishing: false };
  }
}
