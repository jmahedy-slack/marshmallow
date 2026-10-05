# Feature: Vehicle Consistency Workbench

**Repo feature ID:** `vehicle-consistency-workbench`  
**Demo channel:** link this doc + repo in your Slack *feature* channel.

## What it does

When a customer uploads a damage photo in a claim Slack channel, Marshmallow:

1. Runs **OpenAI vision** on the image (make, model, colour, plate, damage).
2. Compares detected attributes to **insured vehicle** on Salesforce `Claim__c`.
3. Surfaces **mismatch flags** (registration, make/model, body style, colour) in Slack threads and channel canvas.
4. Feeds the **fraud profiler** and supports **hold / release** on the claim.

This is the flagship demo path for **claims fraud + vision**, separate from the mobile payment SEV1 storyline.

## Try the HTTP workbench (local or Heroku)

```bash
# Feature manifest (for Slack / GitHub channel pin)
curl -s http://localhost:3002/v1/features/vehicle-consistency-workbench | jq

# Canned demo: high-risk mismatch (Mercedes A-Class policy vs GLE in photo)
curl -s -X POST http://localhost:3002/v1/workbench/vehicle-consistency \
  -H 'Content-Type: application/json' \
  -d '{"scenarioId":"mismatch-high"}' | jq

# Control case: policy matches photo
curl -s -X POST http://localhost:3002/v1/workbench/vehicle-consistency \
  -H 'Content-Type: application/json' \
  -d '{"scenarioId":"match-clean"}' | jq
```

Production (mm-claims):

```bash
curl -s https://mm-claims-32134935dd68.herokuapp.com/v1/workbench/demo-scenarios
```

## Slack demo script (5 min)

1. Open **Claims Fraud Agent** in Slack → review `CLM-0121` or a live `#clm-*` channel.
2. Upload a vehicle damage photo (or use seeded claim images).
3. Show the **:mm:** thread: vision summary + **vehicle consistency** block.
4. Click **Put on fraud hold** → Salesforce `Claim_Status__c` + `Internal_Notes__c` update.
5. Point to this repo: `src/vision/vehicleConsistency.js` + `src/workbench/`.

## Key files

| Path | Role |
|------|------|
| `src/workbench/vehicleConsistencyWorkbench.js` | Demo API + scenarios |
| `src/vision/vehicleConsistency.js` | Comparison engine |
| `src/vision/damageAnalysis.js` | OpenAI / vision routing |
| `src/handlers/claimChannelWatch.js` | Auto-runs on channel images |

## Related work

- Jira **MAR-9** (vehicle mismatch alerts) — product backlog  
- Jira **MAR-42** — June 2026 mobile payment SEV1 (separate incident arc)
