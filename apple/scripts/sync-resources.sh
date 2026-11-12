#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
dest="$root/apple/ByoGlotKit/Sources/ByoGlotCore/Resources"
check=false
if [[ "${1:-}" == --check ]]; then
  check=true
elif [[ $# != 0 ]]; then
  echo "Usage: $0 [--check]" >&2
  exit 2
fi
status=0
sync_file() {
  local source="$1" target="$2"
  if $check; then
    if ! cmp -s "$source" "$target"; then
      echo "Different or missing: ${target#"$root/"}"
      status=1
    fi
  else
    mkdir -p "$(dirname "$target")"
    cp "$source" "$target"
  fi
}
for name in languages presets limits builtin-template errors; do
  sync_file "$root/contracts/$name.json" "$dest/contracts/$name.json"
done
for source in "$root"/lib/translate/profiles/*.md; do
  sync_file "$source" "$dest/profiles/$(basename "$source")"
done
if [[ -d "$dest" ]]; then
  for target in "$dest"/contracts/*.json "$dest"/profiles/*.md; do
    [[ -f "$target" ]] || continue
    if [[ "$target" == "$dest/contracts/"* ]]; then
      source="$root/contracts/$(basename "$target")"
    else
      source="$root/lib/translate/profiles/$(basename "$target")"
    fi
    if [[ ! -f "$source" ]]; then
      if $check; then
        echo "Unexpected: ${target#"$root/"}"
        status=1
      else
        rm "$target"
      fi
    fi
  done
fi
exit "$status"
