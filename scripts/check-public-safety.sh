#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

failures=0

check_pattern() {
  local label="$1"
  local pattern="$2"
  if rg -n --hidden --glob '!/.git/**' --glob '!scripts/check-public-safety.sh' -- "$pattern" .; then
    printf "\nPublic safety check failed: %s\n" "$label" >&2
    failures=1
  fi
}

check_pattern "absolute local user paths" '/Users/[^[:space:]"'"'"']+/'
check_pattern "private vault-style paths" 'Documents/Brain/Brain'
check_pattern "likely private keys" '-----BEGIN (RSA |OPENSSH |EC |DSA |)PRIVATE KEY-----'
check_pattern "GitHub tokens" 'gh[pousr]_[A-Za-z0-9_]{20,}'
check_pattern "Slack tokens" 'xox[baprs]-[A-Za-z0-9-]{20,}'

if [ -d "outputs/graph3d-visual-acceptance" ]; then
  if rg -a -n -- '/Users/|Documents/Brain/Brain|private_sentinel' outputs/graph3d-visual-acceptance; then
    printf "\nPublic safety check failed: Graph3D visual acceptance artifacts contain a private marker\n" >&2
    failures=1
  fi
fi

if git ls-files | rg '(^|/)(config\.json|.*\.local\.json)$'; then
  printf "\nPublic safety check failed: versioned local config file\n" >&2
  failures=1
fi

if [ "$failures" -ne 0 ]; then
  exit 1
fi

printf "Public safety check passed.\n"
