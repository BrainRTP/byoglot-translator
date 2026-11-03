const escapeCode = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unescapeCode = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

export function toVisible(text: string, slots: Record<string, string>): string {
  return text.replace(/<x(\d+)\/>/g, (tag, n: string) =>
    slots[n] ? `<c${n}>${escapeCode(slots[n])}</c${n}>` : tag,
  );
}

export function fromVisible(text: string, slots: Record<string, string>): string | null {
  let broken = false;
  const out = text.replace(/<c(\d+)>([\s\S]*?)<\/c\1>/g, (_, n: string, inner: string) => {
    if (unescapeCode(inner) !== slots[n]) broken = true;
    return `<x${n}/>`;
  });
  return broken || /<\/?c\d+>/.test(out) ? null : out;
}
