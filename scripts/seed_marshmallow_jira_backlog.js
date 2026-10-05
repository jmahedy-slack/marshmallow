#!/usr/bin/env node
/**
 * Seed Marshmallow insurance backlog in Jira project MAR.
 * Usage: CLAIMS_FRAUD_JIRA_PROJECT_KEY=MAR node scripts/seed_marshmallow_jira_backlog.js
 */
const { createJiraIssue } = require("../src/jira/client");

const ISSUES = [
  {
    type: "Bug",
    summary: "Payment gateway: automatic failover when PayStream EU returns HTTP 502",
    description:
      "Checkout and direct debit authorisations fail when the primary EU gateway route degrades. Re-enable secondary route selection and health-based routing so mobile customers are not stuck on a single failing endpoint.",
    labels: ["marshmallow", "payments", "mobile", "fix"],
  },
  {
    type: "Bug",
    summary: "payment-api-eu-west-1: right-size Postgres pool under incident load",
    description:
      "Connection pool exhaustion causes authorisation timeouts during traffic spikes. Review pool max, idle timeout, and PgBouncer settings; add alerts on pool wait time and active connections.",
    labels: ["marshmallow", "payments", "infrastructure", "fix"],
  },
  {
    type: "Bug",
    summary: "payment-service: circuit breaker opens too late after sustained 502s",
    description:
      "Gap between first gateway errors and breaker open leads to retry storms. Lower error-rate thresholds, align health checks with vendor telemetry, and fail fast to secondary route.",
    labels: ["marshmallow", "payments", "reliability", "fix"],
  },
  {
    type: "Bug",
    summary: "Mobile checkout: bounded retry queue for failed authorisations",
    description:
      "Immediate requeue on 502 can backlog the retry worker. Introduce exponential backoff, dead-letter queue, and customer-visible status instead of silent retries.",
    labels: ["marshmallow", "mobile", "payments", "fix"],
  },
  {
    type: "Bug",
    summary: "Claims: Salesforce hold/release must support multi-word Claim_Status__c values",
    description:
      "Release from fraud hold failed when setting status to Under Review via SF CLI. Use REST PATCH for Claim__c updates so spaces and long Internal_Notes__c values are handled safely.",
    labels: ["marshmallow", "claims", "salesforce", "fix"],
  },
  {
    type: "New Feature",
    summary: "Claims Fraud Agent: OpenAI vision for damage photo triage",
    description:
      "Analyse uploaded vehicle photos in Slack claim channels for damage severity, panels affected, and registration plate hints. Default to OpenAI gpt-4o-mini in production; show SIU disclaimer on all vision output.",
    labels: ["marshmallow", "claims", "ai", "product"],
  },
  {
    type: "Task",
    summary: "Run Claims Fraud Agent on Heroku (mm-claims) with Socket Mode",
    description:
      "Deploy Slack bot to Heroku EU dyno with Salesforce CLI auth via SFDX_AUTH_URL, public demo image URL for carousels, and single active Socket Mode connection.",
    labels: ["marshmallow", "claims", "platform"],
  },
  {
    type: "New Feature",
    summary: "One-click Salesforce-linked Slack channel per claim",
    description:
      "From profiler results, create #clm-* channel with pinned investigation brief, canvas, and bot membership. Link channel id back to Claim__c Internal_Notes__c.",
    labels: ["marshmallow", "claims", "slack", "product"],
  },
  {
    type: "New Feature",
    summary: "Vehicle identity mismatch alerts (policy vs photo vision)",
    description:
      "Compare insured make/model/colour/plate on Claim__c with vision-detected vehicle attributes. Surface high-confidence mismatches as fraud signals in Slack threads and canvas.",
    labels: ["marshmallow", "claims", "fraud", "product"],
  },
  {
    type: "Bug",
    summary: "Quote journey: graceful degradation when DVLA enrichment times out",
    description:
      "Quote completion drops when vehicle lookup providers are slow. Cache recent lookups, extend timeouts with partial data, and allow manual vehicle entry without blocking purchase.",
    labels: ["marshmallow", "quotes", "mobile", "fix"],
  },
  {
    type: "Bug",
    summary: "Direct debit setup: clear customer messaging during payment incidents",
    description:
      "Mandate creation failures during SEV1 outages increase support load. Show in-app incident banner, estimated restoration time, and retry CTA tied to gateway health.",
    labels: ["marshmallow", "payments", "mobile", "fix"],
  },
  {
    type: "Task",
    summary: "Customer comms: payment incident email and push templates",
    description:
      "Standardise executive-approved messaging for EU payment outages covering checkout, direct debit, and quote delays. Include status page link and support contact options.",
    labels: ["marshmallow", "comms", "incident"],
  },
  {
    type: "Task",
    summary: "Fraud hold audit trail standard for Claim__c Internal_Notes__c",
    description:
      "Define note format for hold applied, hold released, and profiler runs from Slack. Ensure adjuster-visible history without exceeding field limits.",
    labels: ["marshmallow", "claims", "fraud"],
  },
  {
    type: "New Feature",
    summary: "Slack Assistant: staged fraud review pipeline for adjusters",
    description:
      "Stream profiler steps (channel context, Salesforce load, rule hits, next steps) in Assistant threads with feedback buttons and create-channel CTA.",
    labels: ["marshmallow", "claims", "slack", "product"],
  },
  {
    type: "Task",
    summary: "Re-enable EU secondary payment route after rollout freeze",
    description:
      "Production config currently prefers primary-only routing. Restore weighted routing with health checks before next marketing push in EU markets.",
    labels: ["marshmallow", "payments", "config"],
  },
  {
    type: "Task",
    summary: "Synthetic monitoring: end-to-end mobile checkout probe",
    description:
      "Run scheduled authorisation probe against staging and production gateways. Alert when error rate or latency exceeds SLO for 5 consecutive minutes.",
    labels: ["marshmallow", "observability", "payments"],
  },
  {
    type: "Bug",
    summary: "Claim alert carousel images: stable HTTPS base URL in production",
    description:
      "Slack cannot load hero images when public base URL points at local ngrok. Use Heroku app URL or CDN for /demo/claim-images endpoints.",
    labels: ["marshmallow", "claims", "slack", "fix"],
  },
  {
    type: "New Feature",
    summary: "Profiler rules: incorporate #clm channel messages and attachments",
    description:
      "Extend rules engine to score live Slack channel context (message keywords, image uploads, reporting delay mentions) alongside structured claim fields.",
    labels: ["marshmallow", "claims", "fraud", "product"],
  },
  {
    type: "Task",
    summary: "Incident follow-ups: Jira tasks from #mobile-outage Slack channel",
    description:
      "Automate creation of MAR/EMAL follow-up tasks when SEV1 payment incidents are declared, linking Slack thread, Confluence runbook, and GitHub demo repos.",
    labels: ["marshmallow", "incident", "process"],
  },
  {
    type: "New Feature",
    summary: "Quote completion and policy bind SLO dashboard for mobile app",
    description:
      "Executive dashboard for quote funnel, payment success rate, and bind conversion during incidents. Compare against pre-incident baseline and revenue impact estimates.",
    labels: ["marshmallow", "quotes", "analytics", "product"],
  },
];

async function createWithType(fields) {
  const config = require("../src/config");
  const email = config.jiraEmail;
  const apiToken = config.jiraApiToken;
  const baseUrl = String(config.jiraBaseUrl).replace(/\/$/, "");
  const projectKey = process.env.CLAIMS_FRAUD_JIRA_PROJECT_KEY || "MAR";
  const auth = `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`;

  const { textToAdf } = require("../src/jira/client");

  const response = await fetch(`${baseUrl}/rest/api/3/issue`, {
    method: "POST",
    headers: {
      Authorization: auth,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fields: {
        project: { key: projectKey },
        summary: fields.summary,
        description: textToAdf(fields.description),
        issuetype: { name: fields.type },
        labels: fields.labels,
      },
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.errorMessages?.join("; ") || JSON.stringify(data.errors || data));
  }

  return { key: data.key, url: `${baseUrl}/browse/${data.key}` };
}

async function main() {
  const created = [];
  for (let i = 0; i < ISSUES.length; i++) {
    const issue = ISSUES[i];
    process.stdout.write(`[${i + 1}/${ISSUES.length}] ${issue.summary.slice(0, 60)}… `);
    try {
      const row = await createWithType(issue);
      created.push(row);
      console.log(row.key);
    } catch (err) {
      console.log(`FAILED (${err.message})`);
    }
    await new Promise((r) => setTimeout(r, 350));
  }

  console.log(`\nCreated ${created.length} issue(s) in MAR:`);
  for (const row of created) {
    console.log(`  ${row.key}  ${row.url}`);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
