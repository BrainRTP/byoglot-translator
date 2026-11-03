export function renderReader(text: string, slots: Record<string, string>): string {
  return text
    .replace(/<x(\d+)\/>/g, (_, n: string) => (slots[n] ? `\`${slots[n]}\`` : ""))
    .replace(/<\/?x\d+>/g, "");
}
