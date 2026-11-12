# Building the Firefox add-on from source

These steps rebuild `dist/firefox-mv3`, the content of the Firefox zip, from the sources zip or a clone of the repository.

## Environment

- Any OS that runs Node.js. The release builds run on Ubuntu with Node 26, and Node 24.14 or newer gives the same output.
- Node.js 24 or newer: https://nodejs.org/en/download
- pnpm 12.16.1. It comes with Node through corepack, the exact version is pinned in `package.json` (`packageManager`).

## Commands

```
corepack enable
pnpm install --frozen-lockfile
pnpm build:firefox
```

The output is in `dist/firefox-mv3/`. `pnpm zip:firefox` packs the same build into `dist/byoglot-translator-<version>-firefox.zip` and also writes the sources zip.

`pnpm install` runs `wxt prepare` after installing, and `.pnpmfile.cjs` gives `svelte-check` its own TypeScript 6. Neither changes the build output, but the lockfile expects the hook, so keep `.pnpmfile.cjs` next to `package.json`.

## Notes for reviewers

- The code is bundled by WXT (Vite) and not obfuscated. The sources are TypeScript and Svelte in `entrypoints/` and `lib/`.
- The add-on targets Firefox for Android 160 and newer and desktop Firefox 140 and newer. `web-ext lint` reports exactly three warnings: two `DANGEROUS_EVAL` warnings in `background.js` and an onboarding chunk, and one `UNSAFE_VAR_ASSIGNMENT` warning in a theme chunk. The `Function("")` calls are Zod checking inside `try` whether it may compile validators. Under the extension's CSP that check fails and Zod falls back to plain validation. The `innerHTML` assignment is the Svelte runtime cloning its compiled static templates. Translated text never goes through `innerHTML`: page translations are written into text nodes and the selection card builds its elements with `createElement` and `textContent`.
- By default the extension talks only to `127.0.0.1` and `localhost`, where the user's opencode server runs. Other hosts are optional host permissions: the browser asks for one only when the user adds a provider of type "My provider", and only for that provider's origin.
