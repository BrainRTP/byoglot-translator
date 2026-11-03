import type { BackendErrorKind } from "../opencode/types";

export type PairErrorKind = "expired" | "unreachable" | "badPassword" | "incompatible" | "badLink";

export function pairErrorView(
  kind: BackendErrorKind,
  mode: "link" | "manual",
): { kind: PairErrorKind } {
  if (kind === "unauthorized") return { kind: mode === "link" ? "expired" : "badPassword" };
  if (kind === "offline") return { kind: "unreachable" };
  if (kind === "incompatible") return { kind: "incompatible" };
  return { kind: "badLink" };
}
