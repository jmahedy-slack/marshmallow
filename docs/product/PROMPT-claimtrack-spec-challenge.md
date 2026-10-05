# Prompt: ClaimTrack spec challenge (Slack / Rovo)

Copy the prompt below into Slack (with Jira + GitHub + Confluence MCP connected).

---

Act as a Senior Product Manager + Engineering Lead for Marshmallow.

Investigate **#business-feedback**, Jira **MAR** (`labels = claimtrack`), GitHub **jmahedy-slack/marshmallow**, and Confluence space **SD** (ClaimTrack / claims visibility pages).

Then produce **ClaimTrack — Digital Claims Progress** spec per the engineering-ready template (Executive Summary through Delivery Plan).

**Rules:** Do not invent evidence. Separate evidence vs assumptions. Note overlap with fraud workbench and MAR-42 payment incident.

---

## Where evidence was seeded (for facilitators)

| Source | What to search |
|--------|----------------|
| Slack | `#business-feedback` — claims visibility digest thread |
| Jira | `project = MAR AND labels = claimtrack` |
| GitHub | `docs/product/claimtrack-discovery-index.md`, OpenAPI draft, architecture sketch |
| Confluence | *Business feedback — claims visibility*, *Mobile API Standards* |

Run seeds: `node scripts/seed_business_feedback_slack.js`, `seed_claimtrack_jira.js`, `seed_claimtrack_confluence.js`, `seed_claimtrack_github_issues.js`.
