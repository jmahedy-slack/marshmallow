#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SF_HOME="${ROOT}/.heroku/sf-cli"
SF_BIN="${SF_HOME}/sf/bin/sf"

if [[ -x "$SF_BIN" ]]; then
  echo "heroku-install-sf-cli: Salesforce CLI already installed"
  exit 0
fi

mkdir -p "$SF_HOME"
echo "heroku-install-sf-cli: downloading Salesforce CLI (linux x64)"
curl -sSL "https://developer.salesforce.com/media/salesforce-cli/sf/channels/stable/sf-linux-x64.tar.xz" \
  | tar -xJ -C "$SF_HOME"

if [[ ! -x "$SF_BIN" ]]; then
  echo "heroku-install-sf-cli: expected binary at ${SF_BIN}" >&2
  exit 1
fi

if [[ -x "$SF_BIN" ]]; then
  echo "heroku-install-sf-cli: installed $("$SF_BIN" --version 2>/dev/null | head -1)"
else
  echo "heroku-install-sf-cli: warning — binary missing at ${SF_BIN}" >&2
  exit 1
fi
