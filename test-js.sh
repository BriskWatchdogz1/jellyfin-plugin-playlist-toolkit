#!/usr/bin/env bash
# Unit tests of the pure functions in the web client script (needs Node on the host).
set -euo pipefail
exec node --test "$(dirname "${BASH_SOURCE[0]}")"/tests/js/*.test.mjs
