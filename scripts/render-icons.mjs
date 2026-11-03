import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const SIZES = [16, 32, 48, 96, 128];
const svg = readFileSync(
  new URL("../docs/design/icon/svg/icon-color.svg", import.meta.url),
  "utf8",
);
const out = new URL("../public/icon/", import.meta.url);

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const size of SIZES) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  await page.screenshot({ path: new URL(`${size}.png`, out).pathname, omitBackground: true });
}
await browser.close();
