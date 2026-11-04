const PREFIX = "[ru] ";

export function translate(prompt: string): string {
  const input = prompt.lastIndexOf("\nINPUT:\n");
  if (input >= 0) {
    const segments = JSON.parse(prompt.slice(input + "\nINPUT:\n".length)) as Record<
      string,
      string
    >;
    return JSON.stringify(
      Object.fromEntries(Object.entries(segments).map(([id, text]) => [id, PREFIX + text])),
    );
  }
  const marker = "\n\nTEXT:\n";
  return PREFIX + prompt.slice(prompt.lastIndexOf(marker) + marker.length);
}
