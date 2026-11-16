#!/usr/bin/env bash
# update.sh: update GitHub Copilot CLI and thimble's Copilot plugin, for a daily cron job.
#   - copilot update
#   - copilot plugin update thimble (or install it from the fork when it is missing)
#   - refresh thimble's upstream cache (~/.thimble-copilot/upstream), which an installed plugin reads its prompts from
# Prints the versions, logs to ~/.thimble-copilot/update.log, and exits nonzero on any failure.
# Usage: ./update.sh [--skip-cli]   env: THIMBLE_SOURCE, THIMBLE_NAME, THIMBLE_UPSTREAM_REPO, THIMBLE_COPILOT_HOME
set -u
source_="${THIMBLE_SOURCE:-ayushnangia/thimble:copilot}"
name="${THIMBLE_NAME:-thimble}"
repo="${THIMBLE_UPSTREAM_REPO:-https://github.com/ayushnangia/thimble.git}"
home="${THIMBLE_COPILOT_HOME:-$HOME/.thimble-copilot}"
mkdir -p "$home"
log="$home/update.log"
failed=0
say() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$log"; }
step() {
  local what="$1"; shift
  say "-- $what"
  local out code
  out="$("$@" 2>&1)"; code=$?
  [ -n "$out" ] && say "$out"
  if [ "$code" -ne 0 ]; then say "FAILED ($code): $what"; failed=$((failed + 1)); fi
}

say "thimble-copilot update start"
if ! command -v copilot >/dev/null 2>&1; then say 'FAILED: copilot is not on PATH'; exit 1; fi

[ "${1:-}" = "--skip-cli" ] || step 'copilot update' copilot update

if copilot plugin list --json 2>/dev/null | grep -q "\"name\": *\"$name\""; then
  step "copilot plugin update $name" copilot plugin update "$name"
else
  step "copilot plugin install $source_" copilot plugin install "$source_"
fi

up="$home/upstream"
if [ -d "$up/.git" ]; then
  step 'refresh upstream cache' sh -c "git -C '$up' fetch --depth 1 origin main && git -C '$up' reset --hard FETCH_HEAD"
else
  step 'clone upstream cache' sh -c "git clone --depth 1 --filter=blob:none --sparse '$repo' '$up' && git -C '$up' sparse-checkout set plugin"
fi

say "copilot: $(copilot --version 2>&1 | head -n 1)"
say "plugin: $(copilot plugin list 2>&1 | grep -i "$name" | head -n 1)"
say "upstream: $(git -C "$up" rev-parse --short HEAD 2>&1)"
say "thimble-copilot update end, failures: $failed"
[ "$failed" -eq 0 ]
