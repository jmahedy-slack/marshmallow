#!/usr/bin/env node
/**
 * Seed Jira MAR epic + stories for ClaimTrack spec challenge.
 * Usage: CLAIMS_FRAUD_JIRA_PROJECT_KEY=MAR node scripts/seed_claimtrack_jira.js
 */
require("dotenv").config();
const email = process.env.CLAIMS_FRAUD_JIRA_EMAIL;
const token = process.env.CLAIMS_FRAUD_JIRA_API_TOKEN;
const base = String(process.env.CLAIMS_FRAUD_JIRA_BASE_URL || "").replace(/\/$/, "");
const projectKey = process.env.CLAIMS_FRAUD_JIRA_PROJECT_KEY || "MAR";

const auth = `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;

function textToAdf(text) {
  return {
    type: "doc",
    version: 1,
    content: String(text || "")
      .split(/\n\n+/)
      .filter(Boolean)
      .map((p) => ({
        type: "paragraph",
        content: [{ type: "text", text: p.replace(/\n/g, " ") }],
      })),
  };
}

async function jira(path, body, method = "GET") {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: auth, Accept: "application/json", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

async function createIssue(fields) {
  const data = await jira("/rest/api/3/issue", { fields }, "POST");
  return { key: data.key, url: `${base}/browse/${data.key}` };
}

const EPIC = {
  summary: "Epic: ClaimTrack — Digital Claims Progress (customer-facing)",
  description: [
    "Initiative: Give policyholders clear claim stage, next step, outstanding actions, and ETA in the Marshmallow app.",
    "Evidence: #business-feedback (Sep 2026), contact centre repeat-call analysis, broker requests.",
    "Out of scope for epic: internal fraud Slack agent (see GitHub marshmallow workbench).",
    "Related incident history: MAR-42 payment SEV1 — separate from customer claims UX.",
  ].join("\n\n"),
  labels: ["claimtrack", "business-feedback", "mobile-app", "claims"],
};

const STORIES = [
  {
    summary: "ClaimTrack: canonical claim stage model mapped from Claim__c",
    description: "Define customer-safe stages (Submitted, Assessment, Repair, Settlement…) mapped from Salesforce Claim_Status__c and adjuster workflows.",
    labels: ["claimtrack", "salesforce", "claims"],
  },
  {
    summary: "ClaimTrack: mobile BFF GET /v1/claims/{id}/progress",
    description: "Customer API returning status, stage, nextStep, actionRequired, lastUpdated, estimatedResolution, messages summary.",
    labels: ["claimtrack", "api", "mobile-app"],
  },
  {
    summary: "ClaimTrack: in-app Action Required tasks (photos, police ref)",
    description: "Surface outstanding customer tasks; push notification when task created; complete → update Claim__c.",
    labels: ["claimtrack", "notifications", "mobile-app"],
  },
  {
    summary: "ClaimTrack: reuse existing claim comms thread in app",
    description: "Integrate existing email/SMS claim communication into unified in-app timeline (read-only MVP).",
    labels: ["claimtrack", "comms"],
  },
  {
    summary: "ClaimTrack: reduce status-only contact centre calls (KPI)",
    description: "Measure repeat contacts within 7 days where intent is status-only; target −30% post MVP.",
    labels: ["claimtrack", "analytics", "business-feedback"],
  },
];

const OVERLAP_NOTE = {
  summary: "OVERLAP (internal): Claims Fraud Agent / vehicle workbench — not customer ClaimTrack",
  description:
    "GitHub jmahedy-slack/marshmallow fraud vision workbench is adjuster-facing. Do not conflate with ClaimTrack customer MVP. Link for reuse: Claim__c read APIs, Salesforce org mh-ss27-demo.",
  labels: ["claimtrack", "fraud-agent", "no-customer-ux"],
};

async function main() {
  console.log(`Creating ClaimTrack epic in ${projectKey}…`);
  const epic = await createIssue({
    project: { key: projectKey },
    issuetype: { name: "Task" },
    summary: EPIC.summary,
    description: textToAdf(EPIC.description),
    labels: EPIC.labels,
  });
  console.log("Epic:", epic.key, epic.url);

  for (const story of STORIES) {
    const row = await createIssue({
      project: { key: projectKey },
      issuetype: { name: "Task" },
      summary: story.summary,
      description: textToAdf(story.description + `\n\nParent initiative: ${epic.key} ClaimTrack.`),
      labels: story.labels,
    });
    console.log(" ", row.key, story.summary.slice(0, 55));
    await new Promise((r) => setTimeout(r, 300));
  }

  const overlap = await createIssue({
    project: { key: projectKey },
    issuetype: { name: "Task" },
    summary: OVERLAP_NOTE.summary,
    description: textToAdf(OVERLAP_NOTE.description),
    labels: OVERLAP_NOTE.labels,
  });
  console.log("Overlap doc:", overlap.key);

  console.log("\nJQL for spec challenge:");
  console.log(`  project = MAR AND labels = claimtrack ORDER BY created DESC`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
