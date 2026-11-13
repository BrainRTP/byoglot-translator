import { MAX_EDITOR_TEXT } from "../selection/limits";

export function textProblem(text: string): "empty" | "tooLong" | null {
  if (text.length > MAX_EDITOR_TEXT) return "tooLong";
  return text.trim() ? null : "empty";
}
