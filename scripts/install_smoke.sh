#!/bin/sh
# Install smoke test: installs temper from this checkout into a throwaway
# Claude Code config and checks that it ends up enabled.
#
#   sh scripts/install_smoke.sh
#
# Everything happens in a temporary CLAUDE_CONFIG_DIR, which is deleted on
# exit, so the user's own config is never read or changed. It needs network
# access to install superpowers from the Anthropic plugin directory.
# Exits 0 and prints "temper@temper enabled" on success, non-zero otherwise.

set -eu

repo=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}"/temper-smoke.XXXXXX)
trap 'rm -rf "$tmp"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
tmp=$(cd "$tmp" && pwd -P)

CLAUDE_CONFIG_DIR="$tmp/config"
export CLAUDE_CONFIG_DIR
mkdir -p "$CLAUDE_CONFIG_DIR" "$tmp/work"

# Run from an empty directory, so no project or local settings take part.
cd "$tmp/work"

fail() {
  echo "install_smoke: $*" >&2
  exit 1
}

echo "config dir: $CLAUDE_CONFIG_DIR"

claude plugin marketplace add "$repo" ||
  fail "could not add $repo as a marketplace"

# superpowers comes first: a dependency from another marketplace isn't
# installed with temper (amendment A2).
claude plugin install superpowers@anthropic-plugin-directory ||
  fail "could not install superpowers@anthropic-plugin-directory"

claude plugin install temper@temper ||
  fail "could not install temper@temper"

claude plugin list --json >"$tmp/list.json" ||
  fail "claude plugin list failed"

python3 -I - "$tmp/list.json" <<'PY' || fail "temper@temper is not installed and enabled"
import json, sys

with open(sys.argv[1], encoding="utf-8") as f:
    plugins = json.load(f)
for p in plugins:
    if p.get("id") == "temper@temper" and p.get("enabled") is True:
        sys.exit(0)
print(json.dumps(plugins, indent=2), file=sys.stderr)
sys.exit(1)
PY

echo "temper@temper enabled"
