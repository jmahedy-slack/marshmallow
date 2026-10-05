#!/usr/bin/env node
/**
 * Post suspect claim alerts to CLAIMS_ALERT_CHANNEL with Slack JSON metadata.
 * Usage: node scripts/post_claim_alerts.js [--limit=50]
 */
const config = require("../src/config");
const { publishSuspectClaimAlerts } = require("../src/alerts/publish");

async function main() {
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : 50;

  console.log(`Publishing claim alerts to ${config.claimsAlertChannel}…`);
  const result = await publishSuspectClaimAlerts({ limit });
  console.log(`Posted ${result.count} alert(s) to ${result.channel}`);
  for (const row of result.posted) {
    console.log(`  • ${row.claimId} → ${row.salesforceUrl || "no SF URL"}`);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  if (String(err.message || err).includes("not_in_channel")) {
    console.error("\nInvite the bot to the channel first: /invite @Claims Fraud Agent");
  }
  process.exit(1);
});
