#!/bin/sh
set -eu
version=$(/usr/bin/plutil -extract version raw -o - "$SRCROOT/../package.json")
build=$(git -C "$SRCROOT/.." rev-list --count HEAD)
plist="$DERIVED_FILE_DIR/ByoGlot-Info.plist"
cp "$SRCROOT/iOS/Info.plist" "$plist"
/usr/bin/plutil -replace CFBundleShortVersionString -string "$version" "$plist"
/usr/bin/plutil -replace CFBundleVersion -string "$build" "$plist"
