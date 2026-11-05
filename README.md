# ByoGlot Translator

English | [Русский](README.ru.md)

A Chrome and Firefox extension (Manifest V3) that translates web pages and selected text with a model you bring. You connect it in one of two ways: to your local [opencode](https://opencode.ai), or to your own provider with an API key (DeepSeek, OpenRouter, Ollama, LM Studio or any OpenAI-compatible URL). ByoGlot stands for "bring your own" plus "-glot": the model and the translation instructions are yours. The extension has no accounts or servers of its own and ships no keys. Your text goes only to the connection you picked.

MIT license. Free, no subscription, no ads, no telemetry. An independent project, not affiliated with the opencode team.

<p>
  <img src="docs/screenshots/popup-en.png" width="300" alt="Popup with the Translate page button, template, model, effort and display mode">
  <img src="docs/screenshots/selection-en.png" width="304" alt="Selection card with a dictionary-style translation in the dark theme">
</p>

<img src="docs/screenshots/settings-en.png" width="620" alt="Settings page with connection, language and language prompt sections">

## Why

Most AI translators either lock you into their own subscription or ask for an API key per provider. If you already pay for models in opencode, or have a key from a provider such as DeepSeek, this extension reuses them. You also control how the text is translated: you write the instructions yourself. Keep terms in English and add the translation in brackets, explain academic words with examples and etymology, or just translate plainly. Save those instructions as templates and bind them to sites.

## Features

- Page translation on demand, in two modes: replace the text in place, or show the translation under the original. "Show original" restores the page exactly.
- Visible text is translated first, the rest as you scroll. Content that appears later (modals, popups, infinite feeds, SPA navigation) is translated too.
- Selection translation in a movable, resizable window with two modes. One-shot translates one fragment and closes on a click elsewhere. Pinned stays open and translates every new mouse selection into a feed. Nothing is sent just because you selected something in One-shot mode.
- Templates: presets with a free-form pre-prompt, target language, display mode, and separate model and effort for pages and for selections. Applying a template copies its values to the current tab, so tweaks in the popup never change the saved template unless you save them.
- Site rules: bind a template to `example.com` or `*.example.com`.
- Any model of the active connection, with its effort level (opencode calls it a variant: `none`, `low`, `high`, `max` and so on).
- Several saved connections. Exactly one is active at a time and both pages and selections use it. Each connection remembers its own page and selection models.
- Translation cache in IndexedDB, so repeated strings and repeat visits cost nothing.
- Interface in English and Russian, light and dark themes.

## Requirements

- One of the two: opencode 2.x running as a background service (`opencode service start`; opencode 1.x is not supported), or an API key for an OpenAI-compatible provider. Ollama and LM Studio need no key.
- Chrome, Edge, Brave, Arc or another Chromium browser, or Firefox, with Manifest V3.
- For development: Node.js 24 or newer and pnpm 12 (via corepack).

## Install from source

1. Clone the repository and run `pnpm install`.
2. Build: `pnpm build` for Chromium, `pnpm build:firefox` for Firefox. The output goes to `dist/`.
3. Chromium: open `chrome://extensions`, turn on developer mode, click "Load unpacked" and select `dist/chrome-mv3`.
4. Firefox: open `about:debugging#/runtime/this-firefox`, click "Load Temporary Add-on" and select `dist/firefox-mv3/manifest.json`. Temporary add-ons are removed when Firefox restarts.

After loading, reload tabs that were already open, otherwise they have no content script yet.

## Ways to connect

A connection page opens on first install. Pick "opencode" or "My provider". You can save several connections later in the settings and switch between them. Only the active one is used. Deleting the active connection leaves the extension without one, so your text is never sent to another provider by surprise.

### opencode

1. Run `opencode pair` in a terminal. It prints a one-time link like `http://127.0.0.1:<port>/auth/connect/<code>`, valid for 5 minutes.
2. Paste the link (or the whole command output) on the connection page and click "Connect".

Manual mode is for an opencode server you started yourself with a password, on another port of this computer: enter the URL (`http://127.0.0.1:<port>` or `http://localhost:<port>`), username and password. Remote servers are not supported, because the extension's host permissions cover only `127.0.0.1` and `localhost`.

### My provider

Use this when you have no opencode but have an API key. The extension calls the `chat/completions` and `models` endpoints of an OpenAI-compatible API.

1. Choose a preset: DeepSeek, OpenRouter, Ollama, LM Studio or Custom URL. The preset fills in the base URL, and you can edit it.
2. Paste the API key. Ollama and LM Studio do not need one.
3. Click "Save". The extension checks the provider's `/models` list and saves the connection only if the check passes.

When you add a provider, the browser asks for access to that provider's site. The extension does not ask for access to all sites at install time. `localhost` and `127.0.0.1` need no request, so local Ollama and LM Studio work on any port. If you refuse, the connection is not saved. When you delete a provider, the access is released unless another connection uses the same site.

The key is stored unencrypted in the extension's `storage.local`, like the opencode token. It never reaches web pages or content scripts, and the settings page does not show it back: leave the field empty when editing to keep the old key. If you change the base URL to another site, enter the key again.

Effort works per provider. DeepSeek offers `none` plus the levels its `/models` list reports. OpenRouter offers `none`, `low`, `medium` and `high` for models that support reasoning. Ollama, LM Studio and a custom URL offer only `none`. The default is `none`, and for DeepSeek the extension sends it explicitly, because DeepSeek thinks by default.

For fast selection translation pick a light model with effort `none`, for example `deepseek/deepseek-flash`. Thinking (any effort above `none`) makes translation roughly 5 to 7 times slower.

## Ways to translate

The extension has three flows. They share templates, models and the cache.

### Page

Start it with the "Translate page" button in the popup or the page hotkey (Option+A on macOS, Alt+Shift+T elsewhere). The popup shows progress and has a "Stop" button. To close it, click "Show original" in the popup, which restores the page exactly.

### One-shot

Select text. A small icon appears above the end of the selection. Click it, press the selection hotkey (Option+X on macOS, Alt+Shift+S elsewhere) or use the "Translate selection" item in the context menu. A card with the translation opens next to the selection. Nothing is translated until you do one of these.

Drag the card by its header and resize it by the corner at the bottom right. It cannot leave the viewport. Close it with the cross, with Esc, or with a click outside the card. A click within 16 px around the card does not close it, so a missed drag or resize does not lose the translation. Changing the template in the header translates the selection again.

### Pinned

Click the pin button in the card header. The card stays open and the selection icon stops appearing. Every time you finish a mouse selection on the page, the extension translates it and puts the result at the top of a feed in the card. Each entry shows the original fragment, the translation, the languages and model, and a copy button. A failed entry shows its own "Retry" button. The translation that was open when you pinned the card becomes the first entry.

Selecting text inside the card does not start a translation, so you can copy part of a translation. Selecting with the keyboard does not start one either, but the hotkey and the context menu still add an entry. A template change applies to the next selections only, old entries stay as they are.

Only the cross closes a pinned card. Esc and clicks outside do nothing. Closing it cancels unfinished requests and drops the feed, nothing is saved. Click the pin button again to go back to One-shot, which keeps the top entry.

## Usage

| Action              | macOS    | Other OS    |
| ------------------- | -------- | ----------- |
| Translate selection | Option+X | Alt+Shift+S |
| Translate page      | Option+A | Alt+Shift+T |

You can also use the "Translate page" button in the popup and the "Translate selection" item in the context menu. Change the shortcuts at `chrome://extensions/shortcuts` (Chromium) or in `about:addons`, gear menu, "Manage Extension Shortcuts" (Firefox).

Shortcuts on a non-Latin keyboard layout (for example Russian) have to be checked by hand: switch the layout, press both shortcuts, and rebind them if the browser does not react.

## Pre-prompt examples

- Academic text: "Translate academic vocabulary precisely. After each term add a short explanation in brackets, an example of use and the etymology".
- Technical docs: "Keep function names, commands and file paths as they are. Keep IT terms in English and add the translation in brackets after the first use".
- Casual tone: "Translate simply and briefly, as in a message between colleagues".

## Language prompt

Before the pre-prompt of your template, the extension sends the model a set of rules for the target language: how to avoid word-for-word calques and bureaucratic phrasing, which terms developers use, how to write headings. The rules live in language profiles. The extension ships a Russian profile and a generic one, which is used for every other target language. If the pre-prompt contradicts the language prompt, the model follows the pre-prompt. The language prompt applies to page translation and to selection translation.

It is on by default. In the "Language prompt" section of the settings page you can switch it off, pick another profile or edit the text. "Reset to original" brings the built-in text back. If a new version of the extension changes a profile you edited, the settings page shows a notice and keeps your text.

Missing your language, or want to improve a profile? See [CONTRIBUTING.md](CONTRIBUTING.md#language-profiles).

## How it works

The background service worker holds the connection data (the opencode address and token, or the provider URL and key) and is the only part that talks to the backend. For a provider it sends one `POST {baseUrl}/chat/completions` request per batch, without streaming. For opencode it uses opencode's HTTP API: `GET /api/model` for the model list and `POST /api/experimental/generate/text` for one-shot generation without an agent session, so nothing appears in your opencode history.

The content script walks the page and collects text blocks. Inline markup (links, bold, code) is replaced with numbered placeholders such as `<x1>docs</x1>`, so the model sees whole sentences. Blocks go to the background in batches (25 blocks or 4000 characters, up to 4 requests at once). The model answers with JSON keyed by block id, and the translation is written back into the original text nodes, so links and event handlers keep working. The `title`, `alt` and `placeholder` attributes are translated the same way and are always replaced, also in the bilingual mode. A MutationObserver picks up new content.

The opencode endpoint is marked experimental, so all calls go through one adapter in `lib/opencode/`.

## Privacy

The short version is below, the full policy is in [PRIVACY.md](PRIVACY.md).

The text you translate (plus the page title and domain, and for selections the surrounding paragraph) goes to the active connection. With opencode it goes to your local opencode and from there to the provider of the model you chose. With "My provider" it goes straight to the base URL you entered, and that provider's privacy policy applies. The extension itself sends nothing anywhere else. The opencode token and the provider API key are stored unencrypted in the extension's `storage.local`, like in other extensions of this kind, and never reach web pages or content scripts.

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Development

```
pnpm install
pnpm dev                     # Chromium with hot reload
pnpm dev:firefox             # Firefox
pnpm build                   # dist/chrome-mv3
pnpm build:firefox           # dist/firefox-mv3
pnpm zip && pnpm zip:firefox # store zips and the Firefox sources zip in dist/
pnpm test                    # unit tests (Vitest)
pnpm check                   # tsc, svelte-check, biome
pnpm icons                   # rebuild public/icon from docs/design/icon/svg
npx playwright install chromium
pnpm build && pnpm e2e       # e2e against a mock opencode, no network
pnpm build && pnpm e2e:live  # live test with your opencode on Wikipedia
```

`pnpm e2e:live` is never part of `pnpm e2e`. It pairs with your local opencode, translates https://wikipedia.org/wiki/Node.js with `deepseek/deepseek-flash` and has a small cost. Screenshots go to `/tmp/byoglot-live/`.

Lint the Firefox build with `npx web-ext lint --source-dir dist/firefox-mv3`.

CI runs `check`, `test`, both builds, the Firefox lint and the mock e2e on every push and pull request. Pushing a tag like `v0.2.6` (it has to match the version in `package.json`) builds the zips and attaches them to a GitHub release.

The stack: WXT, Svelte 5, TypeScript 7 (svelte-check runs on TypeScript 6 through `.pnpmfile.cjs`, because it does not support 7 yet), Zod, idb, Vitest, Playwright, Biome. The translation quality stand that tunes the prompts lives in `tests/quality/`, see [CONTRIBUTING.md](CONTRIBUTING.md#checking-a-profile-with-the-quality-stand).

## Known limitations

- Text inside closed shadow DOM is not reachable and is not translated.
- The `>_` mark in the icon is not readable at 16 px.
- Popup errors do not name the provider or HTTP status behind a limit or key error.

## License

[MIT](LICENSE)
