import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Effort } from "./types.ts";

const run = promisify(execFile);

export async function generate(prompt: string, effort: Effort): Promise<string> {
  const body = JSON.stringify({
    prompt,
    model: { providerID: "deepseek", id: "deepseek-flash", variant: effort },
  });
  const { stdout } = await run(
    "opencode",
    ["api", "POST", "/api/experimental/generate/text", "-d", body],
    { maxBuffer: 64 << 20, timeout: 20 * 60_000 },
  );
  return (JSON.parse(stdout) as { data: { text: string } }).data.text;
}

export function limiter(limit: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    while (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}
