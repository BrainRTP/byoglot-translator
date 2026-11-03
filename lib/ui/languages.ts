import { resolveLang } from "../i18n";
import { LANGUAGE_CODES } from "../settings/languages";

export { LANGUAGE_CODES };

export function languageName(code: string): string {
  const lang = resolveLang();
  try {
    const name = new Intl.DisplayNames([lang], { type: "language" }).of(code) ?? code;
    return name.charAt(0).toLocaleUpperCase(lang) + name.slice(1);
  } catch {
    return code;
  }
}

export function languageOptions(current: string): { code: string; name: string }[] {
  const codes = LANGUAGE_CODES.includes(current) ? LANGUAGE_CODES : [current, ...LANGUAGE_CODES];
  return codes.map((code) => ({ code, name: languageName(code) }));
}
