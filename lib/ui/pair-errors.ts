import type { BackendErrorKind } from "../opencode/types";

export type PairErrorKind =
  | "expired"
  | "unreachable"
  | "badPassword"
  | "incompatible"
  | "https_required"
  | "badLink";

export function pairErrorView(
  kind: BackendErrorKind,
  mode: "link" | "manual",
): { kind: PairErrorKind } {
  if (kind === "unauthorized") return { kind: mode === "link" ? "expired" : "badPassword" };
  if (kind === "offline") return { kind: "unreachable" };
  if (kind === "incompatible") return { kind: "incompatible" };
  if (kind === "https_required") return { kind: "https_required" };
  return { kind: "badLink" };
}
