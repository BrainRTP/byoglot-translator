import { createOpencodeBackend } from "./backend";
import { BackendError, fromFetchFailure } from "./errors";
import { connectSchema } from "./schemas";
import type { Connection } from "./types";

const PAIR_TIMEOUT_MS = 10_000;
const LINK_RE = /https?:\/\/[^/\s"'<>]+\/auth\/connect\/([A-Za-z0-9_-]+)/;

export function parsePairingLink(input: string): { origin: string; code: string } {
  const match = LINK_RE.exec(input);
  const [link, code] = match ?? [];
  if (!link || !code) throw new BackendError("bad_response", { detail: "no pairing link found" });
  try {
    return { origin: new URL(link).origin, code };
  } catch (error) {
    throw new BackendError("bad_response", { detail: "invalid pairing link", cause: error });
  }
}

export async function pair(
  input: string,
  fetchImpl: typeof fetch = (url, init) => fetch(url, init),
): Promise<Connection> {
  const { origin, code } = parsePairingLink(input);
  const signal = AbortSignal.timeout(PAIR_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(`${origin}/auth/connect/${code}`, { signal });
  } catch (error) {
    throw fromFetchFailure(error, signal);
  }
  if (response.status === 401) throw new BackendError("unauthorized");
  if (!response.ok) throw new BackendError("bad_response", { detail: `HTTP ${response.status}` });
  const parsed = connectSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new BackendError("incompatible", { detail: "no token in response" });
  const conn: Connection = { url: origin, username: "opencode", password: parsed.data.token };
  await createOpencodeBackend(conn, fetchImpl).info(signal);
  return conn;
}
