/**
 * Marshmallow incident runbook content for Confluence.
 * One runbook matches the active #mobile-outage SEV1 (INC-2026-0616-001).
 */

const SLACK_INCIDENT_CHANNEL = "C0BBZ0ERKNU";
const SLACK_INCIDENT_URL = `https://slack.com/archives/${SLACK_INCIDENT_CHANNEL}`;
const INCIDENT_ID = "INC-2026-0616-001";

function section(title, bodyHtml) {
  return `<h2>${title}</h2>\n${bodyHtml}`;
}

function list(items) {
  return `<ul>${items.map((item) => `<li><p>${item}</p></li>`).join("")}</ul>`;
}

function ordered(items) {
  return `<ol>${items.map((item) => `<li><p>${item}</p></li>`).join("")}</ol>`;
}

function table(headers, rows) {
  const head = headers.map((h) => `<th><p><strong>${h}</strong></p></th>`).join("");
  const body = rows
    .map((row) => `<tr>${row.map((cell) => `<td><p>${cell}</p></td>`).join("")}</tr>`)
    .join("");
  return `<table><tbody><tr>${head}</tr>${body}</tbody></table>`;
}

function runbookMeta({ severity, owner, lastReviewed, relatedChannels }) {
  return (
    `<ac:structured-macro ac:name="info"><ac:rich-text-body>` +
    `<p><strong>Severity:</strong> ${severity}<br/>` +
    `<strong>Owner:</strong> ${owner}<br/>` +
    `<strong>Last reviewed:</strong> ${lastReviewed}<br/>` +
    `<strong>Related channels:</strong> ${relatedChannels}</p>` +
    `</ac:rich-text-body></ac:structured-macro>`
  );
}

const RUNBOOKS = [
  {
    title: "Runbook: Mobile Payment Gateway Outage (SEV1)",
    html: [
      runbookMeta({
        severity: "SEV1 — Critical",
        owner: "Platform Engineering / Payments",
        lastReviewed: "2026-06-16",
        relatedChannels: `#mobile-outage (<a href="${SLACK_INCIDENT_URL}">Slack</a>)`,
      }),
      `<ac:structured-macro ac:name="warning"><ac:rich-text-body>` +
        `<p><strong>Active incident reference:</strong> ${INCIDENT_ID} — Marshmallow Mobile App payment failures since 08:31 BST. Use this runbook for the current EU payment gateway degradation.</p>` +
        `</ac:rich-text-body></ac:structured-macro>`,
      section("Overview", `<p>Covers widespread mobile checkout and direct debit failures caused by third-party payment gateway degradation, HTTP 502 responses, circuit breaker trips, and downstream database pressure on <code>payment-api-eu-west-1</code>.</p>`),
      section(
        "When to invoke",
        list([
          "Datadog/CloudWatch alert: payment failure rate &gt; 15% for 5 minutes",
          "Gateway health checks failing in EU region",
          "Customer support reports failed payments / direct debit setup errors spike &gt; 200%",
          "Executive escalation for revenue impact (&gt; £40k/hour)",
        ])
      ),
      section(
        "Severity &amp; impact thresholds",
        table(
          ["Metric", "SEV2", "SEV1"],
          [
            ["Failed transactions / hour", "&gt; 500", "&gt; 5,000"],
            ["Affected users", "&gt; 1,000", "&gt; 10,000"],
            ["Revenue impact", "&gt; £10k/hour", "&gt; £40k/hour"],
            ["Support contact increase", "&gt; 100%", "&gt; 200%"],
          ]
        )
      ),
      section(
        "Roles",
        table(
          ["Role", "Responsibility"],
          [
            ["Incident Commander (IC)", "Owns timeline, comms cadence, exec briefings every 30 min"],
            ["Payments Engineering", "Gateway routing, circuit breakers, retry queue, vendor bridge"],
            ["SRE / Platform", "Observability, autoscaling, connection pools, failover routes"],
            ["Database team", "Postgres pool exhaustion on payment-api, query correlation"],
            ["Support Lead", "Hold templated responses until technical all-clear"],
            ["Comms / PR", "Customer status page + in-app messaging"],
          ]
        )
      ),
      section(
        "First 15 minutes",
        ordered([
          "Declare SEV1 in #mobile-outage and assign IC. Pin incident canvas.",
          "Confirm symptoms: HTTP 502 rate, payment authorisation timeouts, direct debit mandate failures.",
          "Check gateway vendor status page and open Sev-1 bridge with provider engineering.",
          "Review circuit breaker state — note gap between first 502 (~08:47) and breaker open.",
          "Enable enhanced logging on payment-api-eu-west-1; pull DB connection pool metrics.",
          "Test secondary payment route (document result in incident canvas).",
          "Post initial exec summary: affected users, failed txn count, £/hour estimate.",
        ])
      ),
      section(
        "Investigation checklist",
        list([
          "<strong>Gateway layer:</strong> HTTP 502/503 rates, latency P95, vendor telemetry vs internal monitors",
          "<strong>Application layer:</strong> payment-api error logs, timeout stack traces, retry queue depth",
          "<strong>Database layer:</strong> connection pool exhaustion, slow queries, RDS CPU/connections",
          "<strong>Network:</strong> EU-West egress, DNS, TLS handshake failures to provider",
          "<strong>Correlation:</strong> compare DB query log anomalies with 502 window (08:47 onwards)",
        ])
      ),
      section(
        "Mitigation playbook",
        ordered([
          "Route eligible traffic to secondary payment provider (if health checks pass).",
          "Tune circuit breaker thresholds if opening too late; enable synthetic payment probes.",
          "Scale payment-api pods only after confirming DB pool headroom (avoid connection storm).",
          "Drain or cap retry queue if backlog &gt; 10k messages.",
          "Coordinate vendor-side config rollback if provider confirms bad deployment.",
          "Prepare customer comms: checkout unavailable, direct debit setup delayed — no double charges.",
        ])
      ),
      section(
        "Communication templates",
        `<h3>Internal (exec briefing)</h3><pre>SEV1 ${INCIDENT_ID}: Mobile payment gateway degradation. ~17k users affected, 22k+ failed txns, ~£52k/hr impact. Vendor engineering engaged 14:20. Root cause investigating — gateway 502 + DB pool pressure on payment-api-eu-west-1. Next update in 30 min.</pre>` +
          `<h3>Customer (status page)</h3><pre>We are investigating an issue affecting mobile payments and direct debit setup. Some customers may see errors at checkout. We are working with our payment provider and will update within 30 minutes.</pre>`
      ),
      section(
        "Recovery verification",
        list([
          "Payment success rate &gt; 99% for 15 consecutive minutes",
          "HTTP 502 rate below 0.1%",
          "Retry queue draining normally",
          "Support ticket volume returning to baseline",
          "No new circuit breaker trips for 30 minutes",
        ])
      ),
      section(
        "Post-incident",
        ordered([
          "Schedule blameless postmortem within 5 business days",
          "Document root cause, breaker delay, and vendor SLA breach (if applicable)",
          "Create Jira follow-ups in EMAL for permanent fixes",
          "Update this runbook with lessons learned",
        ])
      ),
    ].join("\n"),
  },
  {
    title: "Runbook: Mobile Quote Journey Degradation",
    html: [
      runbookMeta({
        severity: "SEV1 / SEV2",
        owner: "Mobile Engineering / Pricing",
        lastReviewed: "2026-06-16",
        relatedChannels: "#mobile-outage, #mobile-app-alerts",
      }),
      section("Overview", `<p>Handles quote completion drops in the Marshmallow mobile app when vehicle enrichment, DVLA lookup, or pricing services degrade. Often co-occurs with broader mobile incidents but can present independently.</p>`),
      section(
        "Detection signals",
        list([
          "Datadog monitor: <code>mobile.quote-journey.conversion.critical</code>",
          "Quote completion rate drop &gt; 25%",
          "API latency P95 &gt; 10s on enrichment/pricing endpoints",
          "Failed quote requests &gt; 1,000/hour",
        ])
      ),
      section(
        "First 15 minutes",
        ordered([
          "Confirm scope: new business quotes only vs renewals vs both",
          "Check third-party DVLA / vehicle lookup provider status",
          "Review enrichment service timeout rates and error budgets",
          "Enable cached vehicle data fallback if available",
          "Notify acquisition/commercial teams of acquisition impact (£/hour lost premium)",
        ])
      ),
      section(
        "Mitigation",
        list([
          "Increase enrichment timeout with graceful degradation (quote without live trim data)",
          "Warm Redis/cache for top 500 VRM lookups",
          "Fail open to manual quote completion path in app (feature flag)",
          "Reduce concurrent enrichment calls per pod",
          "Escalate to pricing service owner if downstream calc errors",
        ])
      ),
      section(
        "Recovery criteria",
        list([
          "Quote completion rate within 5% of 7-day baseline",
          "P95 latency &lt; 3s on quote API",
          "Third-party lookup error rate &lt; 1%",
        ])
      ),
    ].join("\n"),
  },
  {
    title: "Runbook: Claims Fraud Investigation Platform Outage",
    html: [
      runbookMeta({
        severity: "SEV2",
        owner: "Claims Technology / SIU",
        lastReviewed: "2026-06-16",
        relatedChannels: "#claims-fraud-alerts, #clm-* claim channels",
      }),
      section("Overview", `<p>Covers outages affecting the Marshmallow Claims Fraud Agent: Slack bot unresponsive, Salesforce Claim__c sync failures, vision/damage analysis timeouts, or claim channel watch not firing.</p>`),
      section(
        "When to invoke",
        list([
          "Claims Fraud Agent not responding in Slack (Socket Mode disconnect)",
          "Suspect claim alerts not posting to #claims-fraud-alerts",
          "Claim channel image analysis stuck on 'Analysing image…'",
          "Salesforce fraud flag / hold actions failing",
        ])
      ),
      section(
        "First 15 minutes",
        ordered([
          "Check agent health: <code>GET /health</code> on port 3002",
          "Verify Slack Socket Mode connection (bot online in Slack admin)",
          "Confirm OpenAI vision API key and quota (CLAIMS_FRAUD_VISION_API_KEY)",
          "Test Salesforce CLI auth: <code>sf org display --target-org mh-ss27-demo</code>",
          "Review logs for ENOTFOUND slack.com or invalid_blocks errors",
          "Restart agent if websocket timeout; note Slack will not replay missed events",
        ])
      ),
      section(
        "Component checklist",
        table(
          ["Component", "Check", "Fallback"],
          [
            ["Slack bot", "Bot token, app token, channel membership", "Re-invite bot to affected channels"],
            ["Vision analysis", "OpenAI API, model gpt-4o-mini", "Switch to Ollama if configured"],
            ["Carousel images", "ngrok + CLAIMS_FRAUD_PUBLIC_BASE_URL", "Slack file upload fallback"],
            ["Salesforce", "Claim__c write access, org mh-ss27-demo", "Manual SIU hold in SF UI"],
            ["Claim channels", "clm-* naming, SF channel link", "Manual claim review"],
          ]
        )
      ),
      section(
        "SIU business continuity",
        list([
          "High-score suspect claims (&gt; 80) must be manually reviewed in Salesforce",
          "Do not release settlement on claims with open fraud holds",
          "Document any analysis gaps in Claim__c Internal Notes",
        ])
      ),
    ].join("\n"),
  },
  {
    title: "Runbook: Salesforce Claim__c Sync Failure",
    html: [
      runbookMeta({
        severity: "SEV2",
        owner: "Claims Operations / CRM",
        lastReviewed: "2026-06-16",
        relatedChannels: "#claims-fraud-alerts, Salesforce alerts",
      }),
      section("Overview", `<p>Addresses failures syncing claim data between Marshmallow systems and Salesforce <code>Claim__c</code> in org <code>mh-ss27-demo</code> — including seed scripts, fraud flag updates, channel linking, and profiler notes.</p>`),
      section(
        "Symptoms",
        list([
          "Claims created in batch scripts but missing in Salesforce",
          "Fraud_Flag__c not updating after profiler run",
          "Slack claim channels not linked to Claim__c records",
          "Internal Notes missing insured vehicle details (make/model/colour/VRM)",
        ])
      ),
      section(
        "Diagnosis",
        ordered([
          "Verify CLAIMS_FRAUD_SALESFORCE_ENABLED=true and org alias resolves",
          "Run: <code>node scripts/test_salesforce_claim.js</code>",
          "Check sf CLI auth expiry and API limits in Salesforce Setup",
          "Query Claim__c by Name: <code>SELECT Id, Name, Fraud_Flag__c FROM Claim__c WHERE Name = 'CLM-XXXX'</code>",
          "Review required fields: Account__c, Claim_Status__c, Incident_Date__c",
        ])
      ),
      section(
        "Remediation",
        list([
          "Re-authenticate: <code>sf org login web --alias mh-ss27-demo</code>",
          "Re-run seed for failed batch: <code>node scripts/seed_fraud_claims_batch.js --start=N --count=N</code>",
          "Backfill vehicle fields: <code>node scripts/backfill_claim_vehicles.js</code>",
          "Manually link Slack channel ID on Claim__c if API link failed",
        ])
      ),
      section(
        "Data integrity checks",
        list([
          "Insured vehicle note present in Internal_Notes__c",
          "Claim status matches investigation stage (Investigating / Under Review / On Hold)",
          "Profiler fraud notes appended after each analysis run",
        ])
      ),
    ].join("\n"),
  },
  {
    title: "Runbook: Third-Party Vendor Escalation (Payments & Data Providers)",
    html: [
      runbookMeta({
        severity: "SEV1 / SEV2",
        owner: "Vendor Management / Engineering",
        lastReviewed: "2026-06-16",
        relatedChannels: "#mobile-outage, #vendor-escalations",
      }),
      section("Overview", `<p>Standard procedure for escalating Marshmallow's critical third-party dependencies during incidents — payment gateways, DVLA/vehicle data, cloud infrastructure, and fraud data vendors.</p>`),
      section(
        "Vendor tiers",
        table(
          ["Tier", "Examples", "Escalation SLA"],
          [
            ["Tier 1 — Revenue critical", "Payment gateway, core auth", "15 min to Sev-1 bridge"],
            ["Tier 2 — Journey critical", "DVLA lookup, pricing API", "30 min to engineering contact"],
            ["Tier 3 — Supporting", "Analytics, enrichment", "1 hour, business hours"],
          ]
        )
      ),
      section(
        "Escalation steps",
        ordered([
          "Open vendor status page and subscribe to incident updates",
          "Log case number in incident canvas with timestamp",
          "Request named engineering contact (not support tier 1)",
          "Share internal telemetry: error rates, sample correlation IDs, affected regions",
          "Ask for ETA and rollback plan; document in 30-min exec briefing",
          "If SLA breached, notify Vendor Management for contract escalation",
        ])
      ),
      section(
        "Information to provide vendors",
        list([
          "Incident ID (e.g. INC-2026-0616-001)",
          "Time window of first failures (UTC and BST)",
          "HTTP status codes and sample request IDs",
          "Affected region (EU-West-1, UK, etc.)",
          "Business impact summary (£/hour, txn count)",
        ])
      ),
      section(
        "Active incident note",
        `<p>During ${INCIDENT_ID}, payment gateway vendor engineering joined bridge at 14:20. Use this runbook to structure future vendor engagements and ensure telemetry is shared both ways.</p>`
      ),
    ].join("\n"),
  },
];

function parentPageHtml() {
  return [
    `<p>Operational runbooks for Marshmallow incident response. Each child page covers a distinct incident class with detection, response, mitigation, and recovery steps.</p>`,
    section(
      "Runbook index",
      list([
        `<strong>Mobile Payment Gateway Outage (SEV1)</strong> — matches active incident ${INCIDENT_ID}`,
        "Mobile Quote Journey Degradation",
        "Claims Fraud Investigation Platform Outage",
        "Salesforce Claim__c Sync Failure",
        "Third-Party Vendor Escalation",
      ])
    ),
    section(
      "Conventions",
      list([
        "SEV1 = customer-facing revenue or safety impact; exec briefing every 30 minutes",
        "War room Slack channel is single source of truth; pin incident canvas",
        "All SEV1/SEV2 incidents require postmortem within 5 business days",
        "Link Jira follow-ups in EMAL project for engineering remediation",
      ])
    ),
    `<p><em>Maintained by Marshmallow Platform Engineering. Last updated 2026-06-16.</em></p>`,
  ].join("\n");
}

module.exports = {
  RUNBOOKS,
  parentPageHtml,
  PARENT_TITLE: "Marshmallow Incident Runbooks",
};
