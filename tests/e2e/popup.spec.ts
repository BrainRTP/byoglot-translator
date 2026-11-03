import { openPopup } from "./extension";
import { expect, test } from "./fixtures";

test("model and mode rows share the same columns", async ({ paired, mock }) => {
  const page = await paired.context.newPage();
  await page.goto(`${mock.url}/fixtures/article.html`);
  const popup = await openPopup(paired, page);

  const effort = popup.getByRole("combobox", { name: "Effort" });
  const lang = popup.getByRole("combobox", { name: "Translate to" });
  await expect(lang).toBeVisible();

  const [a, b] = await Promise.all([effort.boundingBox(), lang.boundingBox()]);
  expect(a?.x).toBe(b?.x);
  expect(a?.width).toBe(b?.width);
});

test("the effort list opens under its field and stays inside the popup", async ({
  paired,
  mock,
}) => {
  const page = await paired.context.newPage();
  await page.goto(`${mock.url}/fixtures/article.html`);
  const popup = await openPopup(paired, page);

  const effort = popup.getByRole("combobox", { name: "Effort" });
  await effort.click();
  const first = effort.getByRole("option").first();
  await expect(first).toBeVisible();

  const field = await effort.boundingBox();
  const option = await first.boundingBox();
  if (!field || !option) throw new Error("no boxes");
  const width = popup.viewportSize()?.width ?? 0;
  const below = option.y >= field.y + field.height;
  const above = option.y + option.height <= field.y;
  expect(below || above).toBe(true);
  expect(option.x).toBeGreaterThanOrEqual(field.x);
  expect(option.x + option.width).toBeLessThanOrEqual(width);
});
