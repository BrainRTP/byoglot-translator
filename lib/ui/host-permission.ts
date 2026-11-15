import { browser } from "wxt/browser";
import { isLocalOrigin, originPattern } from "../connections/list";
import { BackendError } from "../opencode/errors";
import { validProviderUrl } from "./connection-logic";
import { isAndroid } from "./platform";

export async function requireOriginAccess(baseUrl: string): Promise<void> {
  if (!validProviderUrl(baseUrl, await isAndroid())) throw new BackendError("incompatible");
  if (isLocalOrigin(baseUrl)) return;
  if (!(await browser.permissions.contains({ origins: [originPattern(baseUrl)] }))) {
    throw new BackendError("unauthorized");
  }
}

export function requestOrigin(baseUrl: string): Promise<boolean> {
  // The browser also needs access to loopback addresses outside the manifest grants.
  return browser.permissions.request({ origins: [originPattern(baseUrl)] });
}
