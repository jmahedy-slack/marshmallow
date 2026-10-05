#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SF="$("$(dirname "$0")/heroku-sf-bin.sh")"
export PATH="$(dirname "$SF"):${ROOT}/node_modules/.bin:${PATH}"

if [[ -n "${SFDX_AUTH_URL:-}" ]] && [[ -x "$SF" ]]; then
  ORG_ALIAS="${CLAIMS_FRAUD_SALESFORCE_ORG:-mh-ss27-demo}"
  AUTH_FILE="$(mktemp)"
  printf '%s' "$SFDX_AUTH_URL" > "$AUTH_FILE"
  "$SF" org login sfdx-url --sfdx-url-file "$AUTH_FILE" --alias "$ORG_ALIAS" --set-default 2>/dev/null || true
  rm -f "$AUTH_FILE"
fi

exec node "${ROOT}/src/index.js"
