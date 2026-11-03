import type { BackendErrorKind } from "../opencode/types";
import type { Segment, SegmentResult } from "../translate/service";

export const PAGE_PORT_NAME = "oct-page";

export type PortToBackground =
  | {
      type: "translate";
      jobId: string;
      segments: Segment[];
      page: { title: string; hostname: string };
    }
  | { type: "abort"; jobId: string };

export type PortToContent =
  | { type: "results"; jobId: string; results: SegmentResult[] }
  | { type: "failed"; jobId: string; ids: string[] }
  | { type: "fatal"; jobId: string; kind: BackendErrorKind; retryAfterMs?: number }
  | { type: "done"; jobId: string };
