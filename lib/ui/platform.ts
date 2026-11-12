import { browser } from "wxt/browser";

export async function isAndroid(): Promise<boolean> {
  try {
    return (await browser.runtime.getPlatformInfo()).os === "android";
  } catch {
    return false;
  }
}
