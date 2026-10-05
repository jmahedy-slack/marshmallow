#!/usr/bin/env bash
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CANDIDATES=(
  "${ROOT}/.heroku/sf-cli/sf/bin/sf"
  "${ROOT}/node_modules/.bin/sf"
  "/usr/local/bin/sf"
  "sf"
)
for candidate in "${CANDIDATES[@]}"; do
  if [[ -x "$candidate" ]]; then
    echo "$candidate"
    exit 0
  fi
done
command -v sf 2>/dev/null || echo "sf"
