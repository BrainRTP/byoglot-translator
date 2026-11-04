import { browser } from "wxt/browser";
import { isLocalOrigin, originOf, originPattern } from "../connections/list";

export function requestOrigin(baseUrl: string): Promise<boolean> {
  const origin = originOf(baseUrl);
  if (isLocalOrigin(origin)) return Promise.resolve(true);
  return browser.permissions.request({ origins: [originPattern(baseUrl)] });
}
