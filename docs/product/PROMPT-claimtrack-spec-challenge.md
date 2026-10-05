# Prompt: ClaimTrack spec challenge (Slack / Rovo)

Copy into Slack with **Jira, GitHub, and Confluence** connected.

---

Act as a Senior Product Manager + Engineering Lead for Marshmallow.

Investigate **#business-feedback**, Jira **MAR** (`labels = claimtrack`), GitHub **jmahedy-slack/marshmallow**, and Confluence space **SD**.

Then produce **ClaimTrack — Digital Claims Progress** (Executive Summary through Delivery Plan).

**Rules:** Do not invent evidence. Separate **Evidence** vs **Assumptions**. Note overlap with fraud workbench and MAR-42 payment SEV1.

## Architecture diagrams (required)

Include **at least four** diagrams using **Mermaid** syntax in fenced code blocks (so they render in Slack/GitHub/Confluence):

1. **System context (C4 Level 1)** — Customer, Mobile App, Marshmallow BFF, Claims Platform, Salesforce, Notification Service, Analytics.
2. **Container / component (C4 Level 2)** — ClaimTrack MVP services and data stores; label **reuse** vs **new build** from GitHub evidence.
3. **Sequence diagram** — Happy path: customer opens claim progress → BFF → claims data → response; include optional push for “Action required”.
4. **Deployment / runtime** — Mobile, API gateway, Heroku/cloud services (reference mm-claims / existing repos where evidenced).

For each diagram:

- Title and one-line purpose  
- Legend for dashed lines = assumed integration  
- Short caption citing evidence (GitHub path, Jira key) or **Assumption**

Optionally add a **data flow diagram** for claim stage / events (`claim.stage.changed`, etc.) if supported by architecture docs.

Do not use image-only diagrams unless you also provide Mermaid source.

---

## Facilitator: seeded evidence

| Source | Search |
|--------|--------|
| Slack | `#business-feedback` — claims visibility thread |
| Jira | `project = MAR AND labels = claimtrack` |
| GitHub | `docs/product/claimtrack-discovery-index.md`, `docs/architecture/claims-customer-api-sketch.md`, OpenAPI draft |
| Confluence | Business feedback — claims visibility; Mobile API Standards |

Seeds: `npm run seed:claimtrack` (see `package.json`).
