import { createBackendProvider, lazyCache } from "../lib/background/connection";
import { registerBackground } from "../lib/background/register";
import { openTranslationCache } from "../lib/cache/cache";
import { createOpencodeBackend } from "../lib/opencode/backend";
import { pair } from "../lib/opencode/pairing";
import { createTranslationService } from "../lib/translate/service";

export default defineBackground(() => {
  const getBackend = createBackendProvider((conn) => createOpencodeBackend(conn));
  const cache = lazyCache(() => openTranslationCache());
  registerBackground({
    getBackend,
    createBackend: (conn) => createOpencodeBackend(conn),
    pair: (link) => pair(link),
    cache,
    service: createTranslationService({ getBackend, cache }),
  });
});
