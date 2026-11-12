# Shared contracts

TypeScript in `lib/` is the reference implementation. Data and fixture expectations in `contracts/` are generated from it with `UPDATE_CONTRACTS=1 pnpm test tests/unit/contracts` and checked by `pnpm test`. A native implementation loads the same files in its own tests and must produce `expected` for every `input`.

A behavior change belongs in one pull request containing the TypeScript change, regenerated contract files and every native implementation that exists at that time.

Fixture files have the format `{ "contract": string, "version": number, "cases": [{ "name": string, "input": any, "expected": any }] }`. Segment ids are canonical non-negative integers written as strings. Sort them as numbers to reproduce JavaScript object key order. A repeated id in a model response uses the last value, as in `JSON.parse`. Every JSON file uses two-space indentation and a trailing newline. The harness checks the contract name and version and prints each changed case name during an update.

String lengths are UTF-16 code units, as in JavaScript `String.length`. The compact `JSON.stringify` output is part of the page prompt: there is no space after `:` or `,`, `/` and non-ASCII characters are not escaped, and control characters are escaped as `\b \f \n \r \t` or `\u00xx` with lower-case hex. U+2028 and U+2029 stay unescaped. Lone UTF-16 surrogates are escaped with lower-case hex, for example `\ud83d`.

Language profiles are not copied here. They live in `lib/translate/profiles/<code>.md`; native builds bundle those files as resources. The profile id is the file name without `.md`, and the profile text is the trimmed file content.

Language prompt names use `languages.json`: `auto` selects its `auto` text, known codes use `names[code]`, and off-list codes, including region codes such as `pt-BR`, use the code itself. Prompt language names come only from this fixed table, without a locale-dependent display-name lookup. The `codes` array preserves picker order.

Provider responses that do not match the expected JSON shape have kind `incompatible` and the fixed detail `unexpected response shape`, independent of the validator library.

`Retry-After` is trimmed before parsing. Seconds must match `[0-9]+(\.[0-9]+)?`: a non-negative decimal integer or fraction, without a sign, exponent or hexadecimal prefix. Multiply by 1000 and round to the nearest millisecond; non-finite results are ignored. A date must be an IMF-fixdate HTTP date, for example `Thu, 01 Jan 2026 00:00:10 GMT`, with English weekday/month names, GMT and a valid calendar date. Its delay is the date minus the current time, clamped to zero. Other values, including `-1`, are ignored.

`samples/export-v1.json` is a raw portable export sample, outside the fixture envelope. Tests validate it with `parseExport` and with the published JSON Schema through the installed Zod `fromJSONSchema` conversion. Both reject unknown keys, including nested connection secrets.

The export format contains portable globals, templates, profile overrides, site rules and provider connections without secrets. It excludes opencode connections. Native apps ignore `siteRules`. Model references keep `connectionId`; an importer drops references whose connection id is absent from `connections`. Export and import controls are a separate change.

| File                             | Pins                                                   | TypeScript source                                                                           |
| -------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `languages.json`                 | Language codes, English names and auto-source wording  | `LANGUAGE_CODES`, `LANGUAGE_NAMES`, `buildPagePrompt`                                       |
| `presets.json`                   | Provider defaults, favorite model and selection effort | `PRESETS`, `FAVORITE`, `SELECTION_DEFAULT_EFFORT`                                           |
| `limits.json`                    | Batch, selection, context, timeout and profile limits  | `DEFAULT_LIMITS`, `GENERATE_TIMEOUT_MS`, `MAX_PROFILE_TEXT`, `MAX_SELECTION`, `MAX_CONTEXT` |
| `builtin-template.json`          | Builtin template and pre-prompt                        | `builtinTemplate`                                                                           |
| `errors.json`                    | Backend error kinds and fatal classification           | `BackendErrorKind`, `isFatal`                                                               |
| `fixtures/prompt-page.json`      | Page translation prompts                               | `buildPagePrompt`                                                                           |
| `fixtures/prompt-selection.json` | Browser selection prompts                              | `buildSelectionPrompt`                                                                      |
| `fixtures/prompt-text.json`      | Native text prompts                                    | `buildTextPrompt`                                                                           |
| `fixtures/parse-page.json`       | JSON extraction and placeholder validation             | `parsePageResponse`                                                                         |
| `fixtures/pack-batches.json`     | Batch ids under block and UTF-16 limits                | `packBatches`                                                                               |
| `fixtures/language-profile.json` | Profile selection and overrides                        | `languagePromptText`                                                                        |
| `fixtures/provider-models.json`  | Model requests, metadata and defaults                  | `createProviderBackend` (`listModels`, `defaultModel`)                                      |
| `fixtures/provider-chat.json`    | Completion requests, content and errors                | `createProviderBackend` (`generate`)                                                        |
| `fixtures/provider-errors.json`  | HTTP error mapping and retry delays                    | `createProviderBackend` (`listModels`)                                                      |
| `fixtures/provider-effort.json`  | Reasoning variants, parameters and key requirements    | `effortVariants`, `effortParams`, `needsKey`                                                |
| `samples/export-v1.json`         | Hand-authored portable export sample                   | `parseExport`, `z.fromJSONSchema`                                                           |
| `schemas/export-v1.schema.json`  | Portable export structure and required fields          | `z.toJSONSchema(exportSchema)`                                                              |
