import { browser } from "wxt/browser";
import { isLocalOrigin, originOf, originPattern } from "../connections/list";

export function requestOrigin(baseUrl: string): Promise<boolean> {
  const origin = originOf(baseUrl);
  // http local origins are already granted by the manifest, https ones need a prompt
  if (isLocalOrigin(origin) && origin.startsWith("http:")) return Promise.resolve(true);
  return browser.permissions.request({ origins: [originPattern(baseUrl)] });
}
