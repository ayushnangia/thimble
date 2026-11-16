#!/usr/bin/env bash
# doctor.sh: checks thimble for GitHub Copilot CLI (see doctor.mjs). Usage: ./doctor.sh [--fetch]
set -u
here="$(cd "$(dirname "$0")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  echo 'FAIL  node: not found on PATH'
  echo '      fix: install Node 22; the extension itself runs in Copilot CLI'
  exit 1
fi
exec node "$here/doctor.mjs" "$@"
