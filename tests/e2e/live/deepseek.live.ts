import { mkdirSync } from "node:fs";
import { openPopup } from "../extension";
import { expect, test } from "../fixtures";
import { queryClosedShadow } from "../shadow";

const SHOTS = "/tmp/byoglot-live-deepseek";
const CYRILLIC = /\p{Script=Cyrillic}/u;
const FIRST_PARAGRAPH = "#mw-content-text .mw-parser-output p:not(.mw-empty-elt)";

test.skip(!process.env.DEEPSEEK_KEY, "set DEEPSEEK_KEY to run against the real DeepSeek API");

// The host permission prompt cannot be answered under automation, so the connection is seeded.
test("translates a real article through DeepSeek without opencode", async ({ ext }) => {
  mkdirSync(SHOTS, { recursive: true });
  await ext.worker.evaluate((key) => {
    const id = "live-deepseek";
    const model = {
      connectionId: id,
      providerID: "deepseek",
      id: "deepseek-flash",
      variant: "none",
    };
    return chrome.storage.local.set({
      connections: [
        {
          id,
          kind: "provider",
          name: "DeepSeek",
          preset: "deepseek",
          baseUrl: "https://api.deepseek.com",
          apiKey: key,
          pageModel: model,
          selectionModel: model,
        },
      ],
      activeConnectionId: id,
      globals: {
        sourceLang: "auto",
        targetLang: "ru",
        displayMode: "replace",
        defaultTemplateId: "builtin-default",
        uiLang: "en",
      },
    });
  }, process.env.DEEPSEEK_KEY as string);

  const page = await ext.context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("https://en.wikipedia.org/wiki/Node.js", { waitUntil: "load" });
  await expect(page.locator(FIRST_PARAGRAPH).first()).toBeVisible();

  for (const scheme of ["light", "dark"] as const) {
    const popup = await openPopup(ext, page);
    await popup.emulateMedia({ colorScheme: scheme });
    await popup.waitForTimeout(1500);
    await popup.screenshot({ path: `${SHOTS}/popup-${scheme}.png` });
    if (scheme === "dark") {
      const started = Date.now();
      await popup.getByRole("button", { name: "Translate page" }).click();
      await expect
        .poll(async () => (await page.locator(FIRST_PARAGRAPH).first().textContent()) ?? "", {
          timeout: 90_000,
        })
        .toMatch(CYRILLIC);
      console.log(`[live] first paragraph: ${((Date.now() - started) / 1000).toFixed(1)}s`);
      await expect(popup.getByRole("progressbar")).toBeHidden({ timeout: 150_000 });
      console.log(`[live] whole page: ${((Date.now() - started) / 1000).toFixed(1)}s`);
      await page.screenshot({ path: `${SHOTS}/page-translated.png` });
      await popup.getByRole("button", { name: "Show original" }).click();
    }
    await popup.close();
  }

  await page.bringToFront();
  await page
    .locator(FIRST_PARAGRAPH)
    .first()
    .evaluate((p) => {
      const range = document.createRange();
      range.selectNodeContents(p);
      const sel = getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
  await expect.poll(() => queryClosedShadow(page, "button.icon"), { timeout: 5000 }).not.toBeNull();
  const icon = await queryClosedShadow(page, "button.icon");
  if (!icon) throw new Error("selection icon disappeared");
  await page.mouse.click(icon.center.x, icon.center.y);
  await expect
    .poll(async () => (await queryClosedShadow(page, ".card .scroll"))?.text ?? "", {
      timeout: 60_000,
    })
    .toMatch(CYRILLIC);
  await page.screenshot({ path: `${SHOTS}/selection-card.png` });

  for (const scheme of ["light", "dark"] as const) {
    const options = await ext.context.newPage();
    await options.emulateMedia({ colorScheme: scheme });
    await options.goto(`chrome-extension://${ext.id}/options.html`);
    await options.waitForTimeout(1500);
    await options.screenshot({ path: `${SHOTS}/options-${scheme}.png`, fullPage: true });
    await options.close();
  }
});
