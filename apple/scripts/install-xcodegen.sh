#!/bin/sh
set -eu
archive="$RUNNER_TEMP/byoglot-xcodegen-2.46.0.zip"
root="$RUNNER_TEMP/byoglot-xcodegen-2.46.0"
curl --fail --location --retry 3 --output "$archive" https://github.com/yonaskolb/XcodeGen/releases/download/2.46.0/xcodegen.zip
printf '4d9e34b62172d645eed6457cac13fc222569974098ef4ee9c3368bedf0196806  %s\n' "$archive" | shasum -a 256 --check
unzip -q "$archive" -d "$root"
printf '%s\n' "$root/xcodegen/bin" >> "$GITHUB_PATH"
"$root/xcodegen/bin/xcodegen" --version
