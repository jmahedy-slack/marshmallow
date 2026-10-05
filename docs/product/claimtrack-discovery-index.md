# ClaimTrack discovery index (evidence for spec challenge)

**Do not treat this file as the Product Specification.** It indexes where evidence lives for the ClaimTrack — Digital Claims Progress initiative.

## Business feedback

| Source | Location |
|--------|----------|
| Slack | `#business-feedback` — claims visibility digest thread (Sep 2026) |
| Catalog | `data/claimtrack/feedback_catalog.json` (5 feedback IDs, 5 themes) |

**Themes:** status visibility, next step, action required, resolution ETA, repeat status-only contacts.

## Jira (MAR)

| Query | Purpose |
|-------|---------|
| `project = MAR AND labels = claimtrack` | Epic + MVP stories |
| `project = MAR AND labels = business-feedback` | Business-linked items |
| MAR-42 | Payment SEV1 — **not** ClaimTrack (avoid duplication) |
| MAR-9, MAR-8 | Internal fraud/channel tooling — reuse Claim__c only |

## GitHub (this repo)

| Path | Purpose |
|------|---------|
| `docs/architecture/claims-customer-api-sketch.md` | Proposed BFF + events |
| `docs/api/claimtrack-progress.openapi.yaml` | Draft progress API |
| `src/salesforce/claim.js` | Existing Claim__c field usage (internal agent) |

## Confluence (space SD) — Google Drive substitute

Search title: **ClaimTrack** or **Business feedback — claims visibility**

If pages are missing, run (valid Atlassian token required):

`node scripts/seed_claimtrack_confluence.js`

## Engineering standards

| Doc | Location |
|-----|----------|
| Mobile API conventions | Confluence: *Marshmallow Mobile API Standards* |
| Observability baseline | Confluence: *Marshmallow Incident Runbooks* index |

## Assumptions vs evidence

- **Evidence:** Slack/Jira/GitHub/Confluence items above must be cited in the spec.
- **Assumption:** Customer-facing mobile app exists; no production ClaimTrack API shipped yet (draft OpenAPI only).
