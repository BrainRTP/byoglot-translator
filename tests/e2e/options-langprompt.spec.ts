import { readFileSync } from "node:fs";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { languageGenitive } from "../../lib/ui/languages";
import { type Extension, openPopup } from "./extension";
import { expect, test } from "./fixtures";
import type { MockOpencode } from "./mock-opencode";
import { NO_PROFILE_LANG, PROFILES_DIR } from "./profile-files";

const builtin = (id: string): string =>
  readFileSync(path.join(PROFILES_DIR, `${id}.md`), "utf8").trim();
const EDIT = "- Keep product names such as Spring and Maven in Latin letters.";

type Stored = Record<string, { text: string; base: string; savedAt: number }>;

async function patchStoredGlobals(ext: Extension, patch: object): Promise<void> {
  await ext.worker.evaluate(async (p) => {
    const { globals } = await chrome.storage.local.get("globals");
    await chrome.storage.local.set({ globals: { ...(globals as object), ...p } });
  }, patch);
}

const storedProfiles = (ext: Extension): Promise<Stored> =>
  ext.worker.evaluate(
    async () =>
      ((await chrome.storage.local.get("languageProfiles")).languageProfiles ?? {}) as Stored,
  );

const storedGlobals = (ext: Extension): Promise<Record<string, unknown>> =>
  ext.worker.evaluate(
    async () => (await chrome.storage.local.get("globals")).globals as Record<string, unknown>,
  );

async function seedProfile(ext: Extension, id: string, text: string, base: string): Promise<void> {
  await ext.worker.evaluate(
    async (s) => {
      await chrome.storage.local.set({
        languageProfiles: { [s.id]: { text: s.text, base: s.base, savedAt: 1 } },
      });
    },
    { id, text, base },
  );
}

async function openSection(ext: Extension, patch: object = {}): Promise<Page> {
  await patchStoredGlobals(ext, { uiLang: "ru", ...patch });
  const page = await ext.context.newPage();
  await page.goto(`chrome-extension://${ext.id}/options.html`);
  await expect(page.locator("#langprompt")).toBeVisible();
  return page;
}

type Controls = {
  section: Locator;
  toggle: Locator;
  profile: Locator;
  text: Locator;
  chip: Locator;
  save: Locator;
  discard: Locator;
  reset: Locator;
  flag: Locator;
};

function controls(page: Page): Controls {
  const section = page.locator("#langprompt");
  return {
    section,
    toggle: section.getByRole("switch", { name: "Использовать языковой промпт" }),
    profile: section.getByRole("combobox", { name: "Профиль" }),
    text: section.getByRole("textbox", { name: "Текст профиля" }),
    chip: section.locator(".chip"),
    save: section.getByRole("button", { name: "Сохранить", exact: true }),
    discard: section.getByRole("button", { name: "Отменить правки" }),
    reset: section.getByRole("button", { name: "Сбросить к исходному" }),
    flag: section.locator(".flag"),
  };
}

function generatedPrompts(mock: MockOpencode): string[] {
  return mock.requests
    .filter((r) => r.path === "/api/experimental/generate/text")
    .map((r) => (r.body as { prompt: string }).prompt);
}

async function translatePage(ext: Extension, mock: MockOpencode): Promise<string[]> {
  const page = await ext.context.newPage();
  await page.goto(`${mock.url}/fixtures/article.html`);
  const popup = await openPopup(ext, page);
  await popup.getByRole("button", { name: "Перевести страницу" }).click();
  await expect(page.locator("#intro")).toContainText("[ru] ", { timeout: 15_000 });
  const prompts = generatedPrompts(mock);
  expect(prompts.length).toBeGreaterThan(0);
  return prompts;
}

test("the toggle switches the section off and the page prompt loses the language block", async ({
  paired,
  mock,
}) => {
  const page = await openSection(paired);
  const c = controls(page);
  await expect(c.toggle).toHaveAttribute("aria-checked", "true");
  await expect(c.profile).toBeEnabled();

  await c.toggle.click();

  await expect(c.toggle).toHaveAttribute("aria-checked", "false");
  await expect(c.section).toContainText("Перевод идет только с пре-промптом шаблона.");
  await expect(c.profile).toBeDisabled();
  await expect(c.text).toBeDisabled();
  await expect(c.save).toBeDisabled();
  await expect(c.flag).toHaveText("Сохранено");
  await expect.poll(async () => (await storedGlobals(paired)).languagePromptEnabled).toBe(false);

  const prompts = await translatePage(paired, mock);
  for (const prompt of prompts) expect(prompt).not.toContain("LANGUAGE STYLE");
});

test("an edit is saved, marked, sent with the next prompt and survives a reload", async ({
  paired,
  mock,
}) => {
  const page = await openSection(paired);
  const c = controls(page);
  await expect(c.chip).toHaveText("встроенный");
  await expect(c.text).toHaveValue(builtin("ru"));
  await expect(c.save).toBeDisabled();
  await expect(c.reset).toHaveCount(0);

  await c.text.fill(`${builtin("ru")}\n${EDIT}`);
  await expect(c.save).toBeEnabled();
  await expect(c.discard).toBeVisible();
  await expect(c.chip).toHaveText("встроенный");

  await c.save.click();

  await expect(c.chip).toHaveText("изменен");
  await expect(c.profile.locator("option[value=ru]")).toHaveText("Русский (изменен)");
  await expect(c.profile.locator("option[value=auto]")).toHaveText(
    "Авто: по языку перевода (Русский)",
  );
  await expect(c.flag).toHaveText("Сохранено");
  await expect(c.save).toBeDisabled();
  await expect(c.discard).toHaveCount(0);
  await expect(c.reset).toBeVisible();
  expect((await storedProfiles(paired)).ru?.text).toBe(`${builtin("ru")}\n${EDIT}`);

  await page.reload();
  await expect(controls(page).text).toHaveValue(`${builtin("ru")}\n${EDIT}`);
  await expect(controls(page).chip).toHaveText("изменен");

  const prompts = await translatePage(paired, mock);
  for (const prompt of prompts) {
    expect(prompt).toContain("LANGUAGE STYLE");
    expect(prompt).toContain(EDIT);
  }
});

test("reset asks first, Escape cancels, the second try restores the built-in text", async ({
  paired,
}) => {
  await seedProfile(paired, "ru", `${builtin("ru")}\n${EDIT}`, builtin("ru"));
  const page = await openSection(paired);
  const c = controls(page);
  await expect(c.chip).toHaveText("изменен");

  await c.reset.click();

  const dialog = c.section.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(
    "Вернуть исходный текст профиля «Русский»? Ваши правки пропадут.",
  );
  await expect(dialog.getByRole("button", { name: "Отмена" })).toBeFocused();
  await expect(c.reset).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(c.reset).toBeFocused();
  await expect(c.text).toHaveValue(`${builtin("ru")}\n${EDIT}`);

  await c.reset.click();
  await dialog.getByRole("button", { name: "Сбросить", exact: true }).click();

  await expect(dialog).toHaveCount(0);
  await expect(c.chip).toHaveText("встроенный");
  await expect(c.text).toHaveValue(builtin("ru"));
  await expect(c.text).toBeFocused();
  await expect(c.profile.locator("option[value=ru]")).toHaveText("Русский");
  await expect(c.reset).toHaveCount(0);
  expect(await storedProfiles(paired)).toEqual({});
});

test("Cancel closes the confirmation and keeps the saved edit", async ({ paired }) => {
  await seedProfile(paired, "ru", `${builtin("ru")}\n${EDIT}`, builtin("ru"));
  const page = await openSection(paired);
  const c = controls(page);

  await c.reset.click();
  await c.section.getByRole("alertdialog").getByRole("button", { name: "Отмена" }).click();

  await expect(c.section.getByRole("alertdialog")).toHaveCount(0);
  await expect(c.reset).toBeFocused();
  await expect(c.chip).toHaveText("изменен");
  expect((await storedProfiles(paired)).ru?.text).toBe(`${builtin("ru")}\n${EDIT}`);
});

test("a draft survives a profile switch and Discard brings the saved text back", async ({
  paired,
}) => {
  const page = await openSection(paired);
  const c = controls(page);
  const draft = `${builtin("ru")}\n- Prefer short sentences.`;

  await c.text.fill(draft);
  await expect(c.save).toBeEnabled();

  await c.profile.selectOption("generic");
  await expect(c.text).toHaveValue(builtin("generic"));
  await expect(c.save).toBeDisabled();
  await expect(c.discard).toHaveCount(0);

  await c.profile.selectOption("auto");
  await expect(c.text).toHaveValue(draft);
  await expect(c.save).toBeEnabled();
  expect(await storedProfiles(paired)).toEqual({});

  await c.discard.click();
  await expect(c.text).toHaveValue(builtin("ru"));
  await expect(c.save).toBeDisabled();
  await expect(c.discard).toHaveCount(0);
});

test("a draft stays while the toggle is off and comes back when it is on", async ({ paired }) => {
  const page = await openSection(paired);
  const c = controls(page);
  const draft = `${builtin("ru")}\n- Prefer short sentences.`;
  await c.text.fill(draft);

  await c.toggle.click();
  await expect(c.text).toBeDisabled();
  await expect(c.discard).toBeDisabled();
  await expect(c.text).toHaveValue(draft);

  await c.toggle.click();
  await expect(c.text).toBeEnabled();
  await expect(c.text).toHaveValue(draft);
  await expect(c.save).toBeEnabled();
});

test("a target language without its own profile shows the generic one and a hint", async ({
  paired,
}) => {
  const page = await openSection(paired, { targetLang: NO_PROFILE_LANG });
  const c = controls(page);

  await expect(c.profile).toHaveValue("auto");
  await expect(c.profile.locator("option[value=auto]")).toHaveText(
    "Авто: по языку перевода (Общий)",
  );
  await expect(c.text).toHaveValue(builtin("generic"));
  await expect(c.section).toContainText(
    `Для ${languageGenitive(NO_PROFILE_LANG)} своего профиля пока нет, используется общий.`,
  );
  await expect(c.section.getByRole("link", { name: "Помочь с профилем" })).toHaveAttribute(
    "href",
    "https://github.com/BrainRTP/byoglot-translator/blob/main/CONTRIBUTING.md#language-profiles",
  );
});

test("a stored profile that does not exist falls back to auto without a warning", async ({
  paired,
}) => {
  const page = await openSection(paired, { targetLang: "ru", languageProfile: "xx" });
  const c = controls(page);

  await expect(c.profile).toHaveValue("auto");
  await expect(c.section).not.toContainText("написан для другого языка");
  await expect(c.text).toHaveValue(builtin("ru"));
});

test("an explicit profile of another language shows a warning, the generic one does not", async ({
  paired,
}) => {
  const page = await openSection(paired, { targetLang: "de" });
  const c = controls(page);
  const warning = "Профиль «Русский» написан для другого языка, перевод может выйти хуже.";
  await expect(c.section).not.toContainText(warning);

  await c.profile.selectOption("ru");
  await expect(c.section).toContainText(warning);
  await expect(c.text).toHaveValue(builtin("ru"));
  await expect(c.section).not.toContainText("своего профиля пока нет");
  await expect.poll(async () => (await storedGlobals(paired)).languageProfile).toBe("ru");

  await c.profile.selectOption("generic");
  await expect(c.section).not.toContainText(warning);
});

test("an edit made on another built-in version shows the update line and Keep removes it", async ({
  paired,
}) => {
  await seedProfile(paired, "ru", `${builtin("ru")}\n${EDIT}`, "an older built-in text");
  const page = await openSection(paired);
  const c = controls(page);
  const line = "Встроенный профиль «Русский» обновился, ваш текст остался прежним.";
  await expect(c.section).toContainText(line);
  await expect(c.chip).toHaveText("изменен");

  await c.section.getByRole("button", { name: "Оставить мой текст" }).click();

  await expect(c.section).not.toContainText(line);
  await expect(c.text).toHaveValue(`${builtin("ru")}\n${EDIT}`);
  await expect.poll(async () => (await storedProfiles(paired)).ru?.base).toBe(builtin("ru"));
});

test("Open the new version puts the built-in text into the draft", async ({ paired }) => {
  await seedProfile(paired, "ru", `${builtin("ru")}\n${EDIT}`, "an older built-in text");
  const page = await openSection(paired);
  const c = controls(page);

  await c.section.getByRole("button", { name: "Открыть новую версию" }).click();

  await expect(c.text).toHaveValue(builtin("ru"));
  await expect(c.save).toBeEnabled();
  await expect(c.reset).toBeVisible();
  await expect(c.chip).toHaveText("изменен");

  await c.discard.click();
  await expect(c.text).toHaveValue(`${builtin("ru")}\n${EDIT}`);
  await expect(c.section).toContainText("обновился");
});

test("a failed save shows the failure flag and keeps the draft", async ({ paired }) => {
  const page = await openSection(paired);
  const c = controls(page);
  const tooLong = "x".repeat(20_001);

  await c.text.evaluate((el) => el.removeAttribute("maxlength"));
  await c.text.fill(tooLong);
  await c.save.click();

  await expect(c.flag).toHaveText("Не удалось сохранить");
  await expect(c.text).toHaveValue(tooLong);
  await expect(c.save).toBeEnabled();
  expect(await storedProfiles(paired)).toEqual({});
});

test("profile names follow the interface language", async ({ paired }) => {
  const page = await openSection(paired);
  const profile = page.locator("#lp-profile");
  await expect(profile.locator("option[value=ru]")).toHaveText("Русский");
  await expect(profile.locator("option[value=generic]")).toHaveText("Общий");

  await page.getByRole("button", { name: "English", exact: true }).click();

  await expect(profile.locator("option[value=ru]")).toHaveText("Russian");
  await expect(profile.locator("option[value=generic]")).toHaveText("Generic");
  await expect(profile.locator("option[value=auto]")).toHaveText(
    "Auto: by target language (Russian)",
  );
  await expect(page.locator("#langprompt").getByRole("switch")).toHaveAccessibleName(
    "Use the language prompt",
  );
});
