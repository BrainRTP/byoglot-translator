# Contributing

For code changes, set the project up as described under "Development" in [README.md](README.md). `pnpm test` and `pnpm check` must pass before you send a pull request.

Bugs, feature requests and language profiles have their own issue forms. A pull request title follows [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:` and so on), because pull requests are squash-merged and the title becomes the commit message.

The rest of this file covers language profiles, the translation rules for one language.

## Language profiles

### What a profile is

The extension builds the translation prompt from three layers, in this order: the fixed frame (output format, tag rules), the language profile of the target language, and the pre-prompt of the user's template. The profile goes under the heading `LANGUAGE STYLE (the user instructions below override it):`, so when a template contradicts a profile, the model follows the template.

A profile only covers how the text reads in the target language: calques, bureaucratic phrasing, typography and the terms that developers who speak that language actually use.

A profile is one Markdown file, `lib/translate/profiles/<code>.md`. The `<code>` is a language code from `lib/settings/languages.ts`, for example `de`. The file goes to the model as is after trimming, so it has no front matter or metadata. When the profile select in the settings is on "Auto", the extension takes the file named after the primary code of the target language (`pt-BR` uses `pt.md`) and falls back to `generic.md`.

You can add a profile only for a code that is already in `lib/settings/languages.ts`. Adding a new language to that list is a separate change, because the language then shows up in every language picker.

### Getting started

Copy `lib/translate/profiles/generic.md` to `lib/translate/profiles/<code>.md` and adapt it to your language. Read `lib/translate/profiles/ru.md` next to it. It was tuned against the quality stand and shows what a language-specific profile adds: a list of calques to avoid, a table of terms and example pairs.

Keep the draft and every version you test as `tests/quality/prompts/lang/<code>-v1.md`, `<code>-v2.md` and so on, as the Russian profile does. When a version is accepted, copy it to `lib/translate/profiles/<code>.md`.

### Writing the text

- Write the instructions in English, so that maintainers who do not speak your language can review them.
- Give words, calques and examples in the target language, and explain each one in English.
- Show the difference with pairs of an English sentence, its word-for-word translation (`Literal`) and the translation a native developer would write (`Good`). The end of `ru.md` has four.
- Take the sentences for those pairs from topics far from the test pages (Spring documentation, Martin Fowler's essay on technical debt, MDN, the `bat` README, the sourdough article). Otherwise the profile fits the test pages and not the language.
- Keep the file at 8000 characters or fewer. `pnpm test` checks it.

### What does not belong in a profile

- Rules about the answer format, JSON or keeping tags intact. The frame handles them. A profile may say how to fit a placeholder like `<x1/>` into the grammar of your language, as `generic.md` does, and nothing more. `pnpm test` rejects profile text that contains `JSON`, `{{`, `USER INSTRUCTIONS` or `INPUT:`.
- Rules for one site or one page.
- Requests to add notes, explanations or transliterations. Those belong in the pre-prompt of a template.

### Checking a profile with the quality stand

The stand translates saved pages with the same prompt the extension builds, so it tests the file you ship. It needs Chromium for Playwright (`npx playwright install chromium`) and a running opencode 2.x service. `tests/quality/lib/opencode.ts` calls the model `deepseek/deepseek-flash` through `opencode api`, so that model has to be available in your opencode. Each run sends requests to it and costs a little. More about the stand is in `tests/quality/README.md`, which is in Russian.

The test corpus is in `tests/quality/corpus.json`. The pages are in English and only the target language changes. The minimum is `spring-resources` (documentation, the page the Russian profile was tuned on), `fowler-techdebt` (an essay, where tags around links get lost) and the selections from all pages. A profile for English needs a source in another language: use `ruwiki-zakvaska` with `--set snapshot=ruwiki-zakvaska --set targetLang=en`, or add a page to `corpus.json`.

Save the pages once. This also builds the `selections` snapshot, so run it for all pages:

```
pnpm quality:snapshot all
```

Then translate each page twice with the config of the shipped prompt, `tests/quality/configs/ext-v1.json`: once with the generic profile as the baseline and once with your profile. Here `de` is the example language and `--run` names the result. `ext-v1.json` uses `spring-resources` unless you set another snapshot:

```
pnpm quality:translate --config tests/quality/configs/ext-v1.json --run de-gen-sp --set targetLang=de --set languagePrompt=profile:generic
pnpm quality:translate --config tests/quality/configs/ext-v1.json --run de-cand-sp --set targetLang=de --set languagePrompt=profile:de
pnpm quality:translate --config tests/quality/configs/ext-v1.json --run de-gen-fw --set targetLang=de --set snapshot=fowler-techdebt --set languagePrompt=profile:generic
pnpm quality:translate --config tests/quality/configs/ext-v1.json --run de-cand-fw --set targetLang=de --set snapshot=fowler-techdebt --set languagePrompt=profile:de
pnpm quality:translate --config tests/quality/configs/ext-v1.json --run de-gen-sel --set targetLang=de --set mode=selection --set snapshot=selections --set frame=frame/selection-v0.txt --set languagePrompt=profile:generic
pnpm quality:translate --config tests/quality/configs/ext-v1.json --run de-cand-sel --set targetLang=de --set mode=selection --set snapshot=selections --set frame=frame/selection-v0.txt --set languagePrompt=profile:de
```

`--set key=value` overrides one field of the config. `profile:<code>` reads `lib/translate/profiles/<code>.md`. To test a draft before you copy it there, use `--set languagePrompt=lang/<code>-v1.md`. A run writes its result to `tests/quality/.data/runs/<run>/`. Read `side-by-side.md` in that folder: it lists each source block with the translation.

Now compare the runs of each page:

```
pnpm quality:lint de-gen-sp de-cand-sp
pnpm quality:lint de-gen-fw de-cand-fw
pnpm quality:lint de-gen-sel de-cand-sel
```

The table has one row per run. `fail1` is the number of blocks that failed the first pass, `fail` is the number still failed after the retries. `enLeft` counts English phrases left in the translation (`SHOW_EN=1 pnpm quality:lint ...` lists them). It is meaningful only for targets in a non-Latin script (ru, uk, ar, he, hi, zh, ja, ko). For a Latin-script target such as German, correct words look like English ones, so the number is noise. `words`, `avgS` and `maxS` give the length of the text and of its sentences. The markers in `tests/quality/lib/lint.ts` are Russian, so for another language the columns `явля` to `yo` carry no meaning. You can add markers for your language: a new marker goes into `tests/quality/lib/lint.ts` and must also be printed as a column in `tests/quality/lint-run.ts`, otherwise it never shows up in the table.

A profile is accepted when all of this holds:

- On every page `fail` is 0, and `fail1` is at most 2% of the blocks on that page. Count the blocks with `grep -c '^### ' tests/quality/.data/runs/<run>/side-by-side.md`.
- Your profile wins at least 60% of the blocks where the judge picked a winner, on every page.
- Your profile has no more confirmed meaning errors than `generic`.
- A native speaker (you or a reviewer) read `side-by-side.md` and found no meaning errors.

The second and third points come from the judge round, which the maintainer runs (see below). The first and the last you can check yourself.

### What to attach to the pull request

- The `pnpm quality:lint` output for the baseline and your profile on every page, and the share of first-pass failures you counted.
- Three to five short before and after pairs from `side-by-side.md`: the source sentence, the baseline output and the output with your profile. One or two sentences each.
- A line saying who read `side-by-side.md` and in which language.

Do not commit whole texts of other sites or whole run results. They have their own licenses, which is why `tests/quality/.data/` is in `.gitignore`.

The maintainer runs the judge round before merging, so you do not have to. The judge is a Claude Code subagent that follows `tests/quality/judge/rubric.md`. The rubric is written in Russian, but its rules are general and the Russian examples are marked. One round compares the runs of one page:

```
node tests/quality/round.ts build --runs de-cand-sp,de-gen-sp --round de-sp --parts 1
node tests/quality/round.ts verify-list --round de-sp
node tests/quality/round.ts score --round de-sp
```

The judge steps between `build` and `verify-list`, and the check of meaning flags before `score`, are described in `tests/quality/README.md`. The `score` output lists each pair as `first|second`, with the run ids sorted alphabetically. `wins` counts the first run and `win% of decided` is its share of the blocks that were not ties. That is why the candidate runs above are named `cand`, which sorts before `gen`: the number then reads directly as the win rate of your profile.

### Changing an existing profile

The procedure is the same, except that the baseline is the current version of the profile instead of `generic`. The old version stays in `tests/quality/prompts/lang/`, so the baseline run uses it, for example `--set languagePrompt=lang/ru-v4.md`, and the candidate uses your new draft, for example `--set languagePrompt=lang/ru-v5.md`. Name the runs so that the candidate sorts first alphabetically, as above.

`tests/unit/translate/profiles.test.ts` pins `ru.md` to `ru-v4.md` and `generic.md` to `default-v1.md`. When you ship a new version of one of them, change the file name in that test.
