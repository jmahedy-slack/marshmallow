# Slack feature channel setup

Recommended channel: **`#feature-vehicle-consistency`**

## GitHub app notifications

After `/github subscribe jmahedy-slack/marshmallow`, enable the feeds you want:

```
/github subscribe jmahedy-slack/marshmallow issues pulls commits deployments releases
/github subscribe jmahedy-slack/marshmallow comments reviews
```

Check what is enabled:

```
/github subscribe list
```

Pin these links in the feature channel:

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
