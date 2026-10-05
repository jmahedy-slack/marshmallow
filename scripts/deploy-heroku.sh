#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

APP_NAME="${1:-marshmallow-claims-fraud-${USER,,}-demo}"

heroku auth:whoami >/dev/null

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git init
fi

if ! git diff --cached --quiet 2>/dev/null || [[ -n "$(git status --porcelain)" ]]; then
  git add -A
  git commit -m "$(cat <<'EOF'
Add Heroku deployment with OpenAI vision defaults.

EOF
)"
fi

if ! heroku apps:info -a "$APP_NAME" >/dev/null 2>&1; then
  heroku create "$APP_NAME"
fi

node scripts/heroku-sync-config.js --app="$APP_NAME"

git push heroku HEAD:main

echo ""
echo "Deployed: https://${APP_NAME}.herokuapp.com/health"
echo "Update Slack CLAIMS_FRAUD_PUBLIC_BASE_URL if needed (auto-set from HEROKU_APP_NAME on dyno)."
