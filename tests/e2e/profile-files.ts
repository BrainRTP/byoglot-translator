import { readdirSync } from "node:fs";
import path from "node:path";
import { LANGUAGE_CODES } from "../../lib/settings/languages";

export const PROFILES_DIR = path.join(import.meta.dirname, "../../lib/translate/profiles");

const withFile = new Set(readdirSync(PROFILES_DIR).map((f) => f.replace(/\.md$/, "")));

// The fixture pages are English, and the page translator skips text already in the target language
export const NO_PROFILE_LANG = LANGUAGE_CODES.find((c) => c !== "en" && !withFile.has(c)) as string;
