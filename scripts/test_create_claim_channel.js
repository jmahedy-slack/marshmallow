#!/usr/bin/env node
/**
 * Smoke test Salesforce / Slack claim channel creation.
 * Usage: node scripts/test_create_claim_channel.js [CLM-0012]
 */
require("dotenv").config();
const { WebClient } = require("@slack/web-api");
const { createClaimChannel } = require("../src/claimChannel/create");

const claimId = process.argv[2] || "CLM-0012";
const token = process.env.CLAIMS_FRAUD_SLACK_BOT_TOKEN;
const alertChannel = process.env.CLAIMS_ALERT_CHANNEL;

if (!token) {
  console.error("CLAIMS_FRAUD_SLACK_BOT_TOKEN is not set");
  process.exit(1);
}

const client = new WebClient(token);

(async () => {
  console.log(`Testing claim channel creation for ${claimId}…`);
  console.log(`User token set: ${Boolean(process.env.CLAIMS_FRAUD_SLACK_USER_TOKEN)}`);

  const result = await createClaimChannel({
    client,
    userId: process.env.CLAIMS_FRAUD_TEST_USER_ID || "",
    sourceChannelId: alertChannel,
    sourceThreadTs: null,
    seed: { claimId },
    teamId: process.env.CLAIMS_FRAUD_TEST_TEAM_ID || "",
    logger: console,
  });

  console.log("\nSuccess:");
  console.log(`  Channel: #${result.channelName} (${result.channelId})`);
  console.log(`  Salesforce linked: ${result.salesforceLinked}`);
  console.log(`  Claim: ${result.claim?.id} → ${result.claim?.salesforceUrl || "no SF URL"}`);
  if (result.warning) console.log(`  Warning: ${result.warning}`);
})().catch((err) => {
  console.error("\nFailed:", err.message || err);
  if (err.data) console.error("Slack data:", JSON.stringify(err.data, null, 2));
  process.exit(1);
});
