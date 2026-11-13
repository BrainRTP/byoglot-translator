#!/bin/sh
set -eu
unset BUILD_NUMBER
script=$(cd "$(dirname "$0")" && pwd)/app-version.sh
fixture=$(mktemp -d "${TMPDIR:-/tmp}/byoglot-version.XXXXXX")
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/repo/apple/iOS" "$fixture/output" "$fixture/no-git/apple/iOS" "$fixture/empty-path"
printf '{"version":"1.2.3"}\n' > "$fixture/repo/package.json"
printf '<?xml version="1.0"?><plist version="1.0"><dict/></plist>\n' > "$fixture/repo/apple/iOS/Info.plist"
cp "$fixture/repo/package.json" "$fixture/no-git/package.json"
cp "$fixture/repo/apple/iOS/Info.plist" "$fixture/no-git/apple/iOS/Info.plist"
git -C "$fixture/repo" init -q
git -C "$fixture/repo" add .
git -C "$fixture/repo" -c user.name=Fixture -c user.email=fixture@example.invalid -c commit.gpgsign=false commit -qm fixture
SRCROOT="$fixture/repo/apple" DERIVED_FILE_DIR="$fixture/output" /bin/sh "$script"
[ "$(/usr/bin/plutil -extract CFBundleVersion raw -o - "$fixture/output/ByoGlot-Info.plist")" = 1 ]
git clone -q --depth 1 "file://$fixture/repo" "$fixture/shallow"
if SRCROOT="$fixture/shallow/apple" DERIVED_FILE_DIR="$fixture/output" /bin/sh "$script" 2> "$fixture/error"; then exit 1; fi
case "$(cat "$fixture/error")" in *'shallow Git history'*) ;; *) exit 1 ;; esac
if SRCROOT="$fixture/no-git/apple" DERIVED_FILE_DIR="$fixture/output" /bin/sh "$script" 2> "$fixture/error"; then exit 1; fi
case "$(cat "$fixture/error")" in *'no Git metadata'*) ;; *) exit 1 ;; esac
if PATH="$fixture/empty-path" SRCROOT="$fixture/repo/apple" DERIVED_FILE_DIR="$fixture/output" /bin/sh "$script" 2> "$fixture/error"; then exit 1; fi
case "$(cat "$fixture/error")" in *'git is unavailable'*) ;; *) exit 1 ;; esac
PATH="$fixture/empty-path" BUILD_NUMBER=123 SRCROOT="$fixture/no-git/apple" DERIVED_FILE_DIR="$fixture/output" /bin/sh "$script"
[ "$(/usr/bin/plutil -extract CFBundleVersion raw -o - "$fixture/output/ByoGlot-Info.plist")" = 123 ]
[ "$(/usr/bin/plutil -extract CFBundleShortVersionString raw -o - "$fixture/output/ByoGlot-Info.plist")" = 1.2.3 ]
printf 'app-version: full history, shallow history, missing Git and explicit override checks passed\n'
