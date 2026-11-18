#!/usr/bin/env bash
# Builds the plugin inside the official .NET SDK container (no SDK needed on the host)
# and writes dist/playlist-toolkit_<version>.zip plus the unpacked folder.
#
#   ./build.sh                     build against the Jellyfin version in Directory.Build.props
#   JELLYFIN_VERSION=12.5.0 ./build.sh
#   SKIP_TESTS=1 ./build.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK_IMAGE="${SDK_IMAGE:-mcr.microsoft.com/dotnet/sdk:10.0}"
JELLYFIN_VERSION="${JELLYFIN_VERSION:-$(sed -n 's:.*<JellyfinVersion[^>]*>\(.*\)</JellyfinVersion>.*:\1:p' "$ROOT/Directory.Build.props")}"
PLUGIN_VERSION="${PLUGIN_VERSION:-$(sed -n 's:.*<PluginVersion[^>]*>\(.*\)</PluginVersion>.*:\1:p' "$ROOT/Directory.Build.props")}"
NAME="PlaylistToolkit_${PLUGIN_VERSION}"
OUT="$ROOT/dist/$NAME"

mkdir -p "$ROOT/.nuget" "$ROOT/dist"

run_dotnet() {
    docker run --rm \
        --user "$(id -u):$(id -g)" \
        -e HOME=/tmp/home -e DOTNET_CLI_HOME=/tmp/home \
        -e DOTNET_CLI_TELEMETRY_OPTOUT=1 \
        -e DOTNET_NOLOGO=1 \
        -e NUGET_PACKAGES=/work/.nuget/packages \
        -v "$ROOT:/work" -w /work \
        "$SDK_IMAGE" "$@"
}

if [ "${SKIP_TESTS:-0}" != "1" ]; then
    run_dotnet dotnet test tests/Jellyfin.Plugin.PlaylistToolkit.Tests \
        -p:JellyfinVersion="$JELLYFIN_VERSION" -p:PluginVersion="$PLUGIN_VERSION" --nologo -v q
fi

run_dotnet dotnet publish src/Jellyfin.Plugin.PlaylistToolkit -c Release \
    -p:JellyfinVersion="$JELLYFIN_VERSION" -p:PluginVersion="$PLUGIN_VERSION" \
    -o /work/src/Jellyfin.Plugin.PlaylistToolkit/bin/publish --nologo -v q

rm -rf "$OUT"
mkdir -p "$OUT"
cp "$ROOT/src/Jellyfin.Plugin.PlaylistToolkit/bin/publish/Jellyfin.Plugin.PlaylistToolkit.dll" "$OUT/"

cat > "$OUT/meta.json" <<JSON
{
  "category": "General",
  "changelog": "",
  "description": "Lets playlist owners manage image, description and per-user sharing, adds a sortable track table, smart shuffle, duplicate warnings and M3U import/export.",
  "guid": "fd26499b-e4c1-4a7d-8648-a898f06e647b",
  "name": "Playlist Toolkit",
  "overview": "Owner-centric playlist features for the web client",
  "owner": "BriskWatchdogz1",
  "targetAbi": "${JELLYFIN_VERSION}.0",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "version": "${PLUGIN_VERSION}",
  "status": "Active",
  "autoUpdate": false,
  "assemblies": []
}
JSON

rm -f "$ROOT/dist/playlist-toolkit_${PLUGIN_VERSION}.zip"
(cd "$ROOT/dist" && python3 -c "
import sys, zipfile, pathlib
name, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for p in sorted(pathlib.Path(name).iterdir()):
        z.write(p, f'{name}/{p.name}')
" "$NAME" "playlist-toolkit_${PLUGIN_VERSION}.zip")

echo "Built $OUT (Jellyfin $JELLYFIN_VERSION)"
ls -l "$OUT" "$ROOT/dist/playlist-toolkit_${PLUGIN_VERSION}.zip"
