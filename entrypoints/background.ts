import { browser } from "wxt/browser";
import {
  createBackendProvider,
  lazyCache,
  withConnectionPolicy,
} from "../lib/background/connection";
import { registerBackground } from "../lib/background/register";
import { openTranslationCache } from "../lib/cache/cache";
import { originPattern } from "../lib/connections/list";
import type { ConnectionRecord } from "../lib/connections/types";
import { createOpencodeBackend } from "../lib/opencode/backend";
import { pair } from "../lib/opencode/pairing";
import { createProviderBackend } from "../lib/provider/backend";
import { createTranslationService } from "../lib/translate/service";
import { requireOriginAccess } from "../lib/ui/host-permission";

function createBackend(rec: ConnectionRecord) {
  return withConnectionPolicy(
    rec,
    rec.kind === "opencode" ? createOpencodeBackend(rec) : createProviderBackend(rec),
  );
}

async function removeOrigin(origin: string): Promise<void> {
  try {
    await browser.permissions.remove({ origins: [originPattern(origin)] });
  } catch {}
}

export default defineBackground(() => {
  const getBackend = createBackendProvider(createBackend);
  const cache = lazyCache(() => openTranslationCache());
  registerBackground({
    getBackend,
    createBackend,
    pair: (link) =>
      pair(link, async (input, init) => {
        await requireOriginAccess(String(input));
        return fetch(input, init);
      }),
    removeOrigin,
    cache,
    service: createTranslationService({ getBackend, cache }),
  });
});
