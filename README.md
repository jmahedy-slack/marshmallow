# Marshmallow Claims Fraud Platform

Slack-native **claims fraud investigation** demo for Marshmallow insurance: Salesforce `Claim__c`, OpenAI vision on damage photos, profiler rules, fraud hold/release, and Heroku deployment.

## Major demo feature: Vehicle Consistency Workbench

Compare **insured vehicle** data with **vision-detected** make, model, colour, and registration from claim photos — the primary SIU-style demo flow.

**Guide:** [docs/FEATURE-vehicle-consistency-workbench.md](docs/FEATURE-vehicle-consistency-workbench.md)

```bash
npm install
npm start
curl -s -X POST http://localhost:3002/v1/workbench/vehicle-consistency \
  -H 'Content-Type: application/json' \
  -d '{"scenarioId":"mismatch-high"}'
```

## Stack

- **Slack** Bolt (Socket Mode) + Assistant + claim channel watch
- **Salesforce** `Claim__c` via CLI / REST
- **OpenAI** `gpt-4o-mini` vision (Heroku: `mm-claims`)
- **Express** HTTP API on `PORT` (default 3002)

## Deploy

- **Heroku:** `bash scripts/deploy-heroku.sh mm-claims`
- **Procfile** + OpenAI + `SFDX_AUTH_URL` for Salesforce

## Other docs

- `slack-manifest.json` — Slack app scopes
- `scripts/seed_marshmallow_jira_backlog.js` — MAR project backlog seed

**Not production software** — demo, runbooks, and incident storytelling only.
