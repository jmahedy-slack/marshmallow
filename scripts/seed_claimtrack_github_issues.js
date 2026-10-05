#!/usr/bin/env node
/**
 * Create GitHub issues for ClaimTrack (spec challenge evidence).
 * Usage: node scripts/seed_claimtrack_github_issues.js
 */
const { execFileSync } = require("child_process");

const REPO = "jmahedy-slack/marshmallow";

const ISSUES = [
  {
    title: "ClaimTrack: draft customer progress OpenAPI (BFF)",
    body: "Draft spec in `docs/api/claimtrack-progress.openapi.yaml`. Not implemented.\n\nLabels: claimtrack, api",
    labels: ["claimtrack", "documentation"],
  },
  {
    title: "ClaimTrack: map Claim__c status to customer-facing stages",
    body: "Salesforce `Claim_Status__c` → customer stage enum. See `docs/architecture/claims-customer-api-sketch.md`.\n\nReuse read patterns from `src/salesforce/claim.js` (internal agent only today).",
    labels: ["claimtrack", "salesforce"],
  },
  {
    title: "ClaimTrack: distinguish from fraud workbench (internal)",
    body: "Vehicle consistency workbench is adjuster/SIU tooling — not customer ClaimTrack.\n\nDiscovery index: `docs/product/claimtrack-discovery-index.md`",
    labels: ["claimtrack", "clarification"],
  },
];

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["pipe", "pipe", "inherit"] });
}

async function main() {
  for (const issue of ISSUES) {
    const labelArgs = issue.labels.flatMap((l) => ["--label", l]);
    try {
      gh(["label", "create", issue.labels[0], "--repo", REPO, "--color", "1D76DB", "--description", "ClaimTrack initiative"]).trim();
    } catch (_) {}
    const url = gh([
      "issue",
      "create",
      "--repo",
      REPO,
      "--title",
      issue.title,
      "--body",
      issue.body,
      ...labelArgs,
    ]).trim();
    console.log(url.split("\n").pop());
  }
}

main();
