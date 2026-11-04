# Privacy policy

ByoGlot Translator is a browser extension that translates web pages and selected text with a model the user runs through opencode. This policy describes what the extension handles and where it goes. Last updated: 2026-11-04.

## What the extension sends, and when

Nothing leaves the browser until you start a translation: the "Translate page" button, a hotkey, the context menu item, the icon next to a selection, or a selection made while the selection card is pinned. Then the extension sends:

- the text of the page blocks being translated, or the selected fragment;
- the page title and its domain;
- for a selection, the paragraph around it;
- the instructions that go with the request: the pre-prompt of your template and the language prompt.

## Where it goes

The request goes to the opencode server on your own computer (`127.0.0.1` or `localhost`) that you connected on the connection page. opencode passes it to the model provider you configured there, and that provider's privacy policy covers what it receives. The extension uses the data only to return the translation.

The extension has no servers of its own. It collects no analytics or telemetry, does not sell or share data, does not use it for advertising, and nobody reads it.

## What stays on your device

- The opencode address and access token, or the username and password of a manual connection. They are stored unencrypted in the extension's `storage.local` and never reach web pages or content scripts.
- Settings, templates, site rules and edited language profiles, in `storage.local`.
- A translation cache in IndexedDB: a SHA-256 hash of each source text with its translation, so that the same text is not paid for twice. Settings, Cache, Clear removes it.

Removing the extension deletes all of this.

## Contact

Questions about this policy: brainrtp@yandex.ru
