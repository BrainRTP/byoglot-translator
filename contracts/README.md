# Shared contracts

TypeScript in `lib/` is the reference implementation. Data and fixture expectations in `contracts/` are generated from it with `UPDATE_CONTRACTS=1 pnpm test tests/unit/contracts` and checked by `pnpm test`. A native implementation loads the same files in its own tests and must produce `expected` for every `input`.

A behavior change belongs in one pull request containing the TypeScript change, regenerated contract files and every native implementation that exists at that time.

Fixture files have the format `{ "contract": string, "version": number, "cases": [{ "name": string, "input": any, "expected": any }] }`. Segment ids are canonical non-negative integers written as strings. Sort them as numbers to reproduce JavaScript object key order. Every JSON file uses two-space indentation and a trailing newline.

String lengths are UTF-16 code units, as in JavaScript `String.length`. The compact `JSON.stringify` output is part of the page prompt: there is no space after `:` or `,`, `/` and non-ASCII characters are not escaped, and control characters are escaped as `\b \f \n \r \t` or `\u00xx` with lower-case hex.

Language profiles are not copied here. They live in `lib/translate/profiles/<code>.md`; native builds bundle those files as resources. The profile id is the file name without `.md`, and the profile text is the trimmed file content.

| File                             |
| -------------------------------- |
| `languages.json`                 |
| `presets.json`                   |
| `limits.json`                    |
| `builtin-template.json`          |
| `errors.json`                    |
| `fixtures/prompt-page.json`      |
| `fixtures/prompt-selection.json` |
| `fixtures/prompt-text.json`      |
| `fixtures/parse-page.json`       |
| `fixtures/pack-batches.json`     |
| `fixtures/language-profile.json` |
| `fixtures/provider-models.json`  |
| `fixtures/provider-chat.json`    |
| `fixtures/provider-errors.json`  |
| `fixtures/provider-effort.json`  |
| `fixtures/export-v1.json`        |
| `schemas/export-v1.schema.json`  |
