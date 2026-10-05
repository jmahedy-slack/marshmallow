# Slack feature channel setup

Pin these links in your **#feature-vehicle-consistency** (or similar) channel:

| Resource | URL |
|----------|-----|
| GitHub repo | https://github.com/jmahedy-slack/marshmallow |
| Feature doc | https://github.com/jmahedy-slack/marshmallow/blob/main/docs/FEATURE-vehicle-consistency-workbench.md |
| Live API (Heroku) | https://mm-claims-32134935dd68.herokuapp.com/v1/features/vehicle-consistency-workbench |
| Demo POST | `curl -X POST …/v1/workbench/vehicle-consistency -d '{"scenarioId":"mismatch-high"}'` |

Suggested channel topic:

> Vehicle Consistency Workbench — vision vs policy fraud signals · repo: jmahedy-slack/marshmallow

Suggested canvas sections:

1. **Problem** — wrong vehicle on claim photos vs policy schedule  
2. **Demo** — CLM-0121 mismatch scenario + Slack `#clm-*` upload  
3. **Engineering** — `src/workbench/`, OpenAI vision, Salesforce hold  
