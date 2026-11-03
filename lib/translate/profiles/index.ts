import { GENERIC_PROFILE } from "../../settings/language-prompt";

export { GENERIC_PROFILE };

const files = import.meta.glob("./*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export const BUILTIN_PROFILES: ReadonlyMap<string, string> = new Map(
  Object.entries(files).map(([path, text]) => [path.slice(2, -3), text.trim()]),
);

export const PROFILE_IDS: readonly string[] = [...BUILTIN_PROFILES.keys()]
  .filter((id) => id !== GENERIC_PROFILE)
  .sort()
  .concat(GENERIC_PROFILE);
