#!/usr/bin/env bash
# Puts the current build into the test server and (re)starts it.
# The server gets a copy, because Jellyfin rewrites meta.json in its plugin folder and dist/ must stay
# exactly as built.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
VERSION="${PLUGIN_VERSION:-$(sed -n 's:.*<PluginVersion[^>]*>\(.*\)</PluginVersion>.*:\1:p' "$ROOT/Directory.Build.props")}"
SOURCE="$ROOT/dist/PlaylistToolkit_${VERSION}"
TARGET="$HERE/.state/plugin"

if [ ! -f "$SOURCE/Jellyfin.Plugin.PlaylistToolkit.dll" ]; then
    echo "No build found in $SOURCE - run ./build.sh first." >&2
    exit 1
fi

mkdir -p "$TARGET" "$HERE/config"
# Mount points of earlier plugin versions (and of the former name PlaylistPlus) are left behind as empty
# folders; Jellyfin would list them.
find "$HERE/config/data/plugins" -maxdepth 1 -type d \( -name 'PlaylistToolkit_*' -o -name 'PlaylistPlus*' \) -empty -delete 2>/dev/null || true
# No stale assembly of an earlier name may stay next to the new one.
find "$TARGET" -maxdepth 1 -type f -name '*.dll' -delete
cp "$SOURCE"/* "$TARGET"/
# One fresh start that picks up the copied build (a second restart right after the first start
# interrupts the first-run setup).
docker compose --project-directory "$HERE" up -d --force-recreate
python3 "$HERE/setup.py"
