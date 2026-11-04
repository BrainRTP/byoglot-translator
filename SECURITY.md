# Security policy

## Reporting a vulnerability

Report it through [private vulnerability reporting](https://github.com/BrainRTP/byoglot-translator/security/advisories/new) on GitHub, or email brainrtp@yandex.ru with "ByoGlot security" in the subject. Please do not open a public issue for a vulnerability.

Include what you found, the steps to reproduce it, the extension version and the browser, and what an attacker could do with it. You will get an answer in the report or by email, and the fix is published after a release that contains it.

## Supported versions

Only the latest release gets security fixes.

## What counts

The parts that matter most for this extension:

- The opencode token or a provider key reaching a web page, a content script or anything outside the background service worker.
- A web page making the extension send text or requests the user did not ask for.
- Model output turning into markup or script on the page or in the selection card. Page translations are written into text nodes and the card renders a limited Markdown, so a way around that is a vulnerability.
- The extension reaching hosts other than `127.0.0.1` and `localhost`.

Not a vulnerability by itself: the token is stored unencrypted in the extension's `storage.local`, as README says. Problems in opencode or in a model provider belong to their own projects.
