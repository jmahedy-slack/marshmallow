#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SF="$("$(dirname "$0")/heroku-sf-bin.sh")"

if [[ -z "${SFDX_AUTH_URL:-}" ]]; then
  echo "heroku-release: SFDX_AUTH_URL not set — skipping Salesforce CLI login"
  exit 0
fi

if [[ ! -x "$SF" ]]; then
  echo "heroku-release: Salesforce CLI not installed — skipping org login"
  exit 0
fi

ORG_ALIAS="${CLAIMS_FRAUD_SALESFORCE_ORG:-mh-ss27-demo}"
echo "heroku-release: authenticating Salesforce org ${ORG_ALIAS}"
AUTH_FILE="$(mktemp)"
trap 'rm -f "$AUTH_FILE"' EXIT
printf '%s' "$SFDX_AUTH_URL" > "$AUTH_FILE"
"$SF" org login sfdx-url --sfdx-url-file "$AUTH_FILE" --alias "$ORG_ALIAS" --set-default
