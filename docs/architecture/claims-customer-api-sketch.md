# Claims customer API sketch (ClaimTrack MVP)

**Status:** Draft architecture — not implemented in production.

## Reuse from existing Marshmallow demo stack

| Capability | Today | ClaimTrack reuse |
|------------|--------|------------------|
| Salesforce `Claim__c` | Fraud agent reads/writes status, notes, fraud flag | **Read** customer-safe fields; map to stages |
| Slack `#clm-*` channels | Internal adjuster collaboration | **Not** exposed to customers in MVP |
| Fraud workbench API | `/v1/workbench/vehicle-consistency` | **No** customer access |
| Payment APIs | `marshmallow-mobile-payments` repo | Out of scope |

## Proposed components

```
Mobile App  →  Claims BFF (new)  →  Claims Platform / Salesforce
                    ↓
              Notification Service (push for Action Required)
                    ↓
              Analytics (status views, task completion)
```

## Identity

- Customer auth via existing Marshmallow identity (assumption: OAuth / session token on mobile).
- BFF authorizes claim access by policyholder ↔ Claim__c relationship.

## Events (assumption)

- `claim.stage.changed`, `claim.action.required`, `claim.message.added` from Salesforce platform events or polling adapter.

## NFR targets (draft)

- P95 BFF latency < 300ms
- 99.9% availability for read path
- Audit log for status views (GDPR)

See OpenAPI: `docs/api/claimtrack-progress.openapi.yaml`.
