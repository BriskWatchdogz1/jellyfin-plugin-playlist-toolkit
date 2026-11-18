#!/usr/bin/env bash
# Throws the test server's state away (config and generated credentials go to the trash) and sets it up again.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
docker compose --project-directory "$HERE" down
for dir in "$HERE/config" "$HERE/.state"; do
    if [ -e "$dir" ]; then gio trash "$dir"; fi
done
"$HERE/deploy.sh"
