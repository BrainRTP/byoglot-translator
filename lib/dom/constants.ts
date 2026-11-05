export const MARK_ATTR = "data-byoglot";
export const BLOCK_ID_ATTR = "data-byoglot-id";

export const BLOCK_TAGS: ReadonlySet<string> = new Set([
  "p",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "td",
  "th",
  "dt",
  "dd",
  "figcaption",
  "blockquote",
  "button",
  "label",
  "summary",
  "option",
  "caption",
  "legend",
  "div",
  "section",
  "article",
  "aside",
  "header",
  "footer",
  "nav",
  "main",
  "form",
  "fieldset",
  "details",
  "figure",
  "ul",
  "ol",
  "dl",
  "table",
  "tr",
  "tbody",
  "thead",
  "tfoot",
  "body",
]);

export const BLOCK_SELECTOR = [...BLOCK_TAGS].join(",");

export const SKIP_TAGS: ReadonlySet<string> = new Set([
  "code",
  "pre",
  "kbd",
  "samp",
  "script",
  "style",
  "noscript",
  "textarea",
  "input",
  "select",
  "svg",
  "math",
]);

export const PRESERVED_INLINE_TAGS: ReadonlySet<string> = new Set(["code", "kbd", "samp"]);

export const VOID_INLINE_TAGS: ReadonlySet<string> = new Set(["br", "img", "wbr"]);

const HIDDEN_STYLE = /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i;

function isInvisible(el: Element): boolean {
  if (el.hasAttribute("hidden")) return true;
  if (el.getAttribute("aria-hidden") === "true") return true;
  const style = el.getAttribute("style");
  return style !== null && HIDDEN_STYLE.test(style);
}

function isNoTranslate(el: Element): boolean {
  return (
    el.getAttribute("translate")?.toLowerCase() === "no" || el.classList.contains("notranslate")
  );
}

export function isSkippable(el: Element, ignoreTag = false): boolean {
  if (!ignoreTag && SKIP_TAGS.has(el.localName)) return true;
  if (el.hasAttribute(MARK_ATTR)) return true;
  const editable = el.getAttribute("contenteditable");
  if (editable !== null && editable.toLowerCase() !== "false") return true;
  return isNoTranslate(el) || isInvisible(el);
}

export function isPreservedInline(el: Element): boolean {
  const tag = el.localName;
  if (BLOCK_TAGS.has(tag) || el.hasAttribute(MARK_ATTR) || isInvisible(el)) return false;
  return PRESERVED_INLINE_TAGS.has(tag) || (!SKIP_TAGS.has(tag) && isNoTranslate(el));
}
