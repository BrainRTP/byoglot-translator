#!/bin/sh
set -eu
fail() { printf 'error: ByoGlot version: %s\n' "$*" >&2; exit 1; }
version=$(/usr/bin/plutil -extract version raw -o - "$SRCROOT/../package.json")
if [ -n "${BUILD_NUMBER:-}" ]; then
    build=$BUILD_NUMBER
else
    command -v git >/dev/null 2>&1 || fail 'git is unavailable; set BUILD_NUMBER explicitly.'
    git -C "$SRCROOT/.." rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail 'source has no Git metadata; set BUILD_NUMBER explicitly.'
    shallow=$(git -C "$SRCROOT/.." rev-parse --is-shallow-repository) || fail 'cannot inspect Git history; set BUILD_NUMBER explicitly.'
    [ "$shallow" = false ] || fail 'shallow Git history; fetch the full history or set BUILD_NUMBER explicitly.'
    build=$(git -C "$SRCROOT/.." rev-list --count HEAD) || fail 'cannot count Git history; set BUILD_NUMBER explicitly.'
fi
case "$build" in ''|*[!0-9]*|0) fail 'BUILD_NUMBER must be a positive integer.' ;; esac
plist="$DERIVED_FILE_DIR/ByoGlot-Info.plist"
/bin/cp "$SRCROOT/iOS/Info.plist" "$plist"
/usr/bin/plutil -replace CFBundleShortVersionString -string "$version" "$plist"
/usr/bin/plutil -replace CFBundleVersion -string "$build" "$plist"
