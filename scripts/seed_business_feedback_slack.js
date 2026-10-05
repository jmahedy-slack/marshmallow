#!/usr/bin/env node
/**
 * Seed #business-feedback with ClaimTrack-related business user feedback (demo).
 * Usage: node scripts/seed_business_feedback_slack.js [--channel=C0C6KCZ5MDZ]
 */
require("dotenv").config();
const { WebClient } = require("@slack/web-api");
const catalog = require("../data/claimtrack/feedback_catalog.json");

const CHANNEL = process.argv.find((a) => a.startsWith("--channel="))?.split("=")[1] || catalog.slackChannelId;

const THREAD_START = {
  text: ":mega: *Business feedback digest — claims visibility* (compiled for product planning)\n\nWe're seeing repeated asks across contact centre, app reviews, and broker channels. *Hypothesis:* customers can't tell *where* a claim is, *what's next*, or *if Marshmallow is waiting on them*.\n\n_Please add examples below — tagging @product and @claims-ops._",
};

const REPLIES = [
  {
    userLabel: "Contact centre lead",
    text: "From QA (Sep): *47%* of repeat calls on open motor claims are *status-only* — customer has no new info. They quote our generic 'Under Review' in the app.",
  },
  {
    userLabel: "Customer panel note",
    text: "Panel quote (BF-2026-041): _\"I submitted photos a week ago but the app still just says Under Review. I don't know if you're waiting on me or the garage.\"_",
  },
  {
    userLabel: "Broker partnerships",
    text: "Brokers want one sentence for their customers: *stage + next step*. Right now they call the adjuster line or guess from Salesforce.",
  },
  {
    userLabel: "App reviews rollup",
    text: "App store theme (Sep): complaints about *not knowing when payout will happen* outrank outcome dissatisfaction. Suggests *ETA / milestone* not just status label.",
  },
  {
    userLabel: "Claims ops",
    text: "When we need police ref or extra photos, *email-only* chase → customers miss it. Need *in-app 'Action required'* with push. Links to outstanding tasks on Claim__c.",
  },
  {
    userLabel: "Product",
    text: "Sounds like one problem dressed five ways: *progress transparency*. Prior art: fraud agent Slack channels are *internal* — nothing customer-facing on mobile. Jira MAR backlog is mostly payment SEV1 + fraud workbench, not policyholder tracking.",
  },
  {
    userLabel: "Engineering",
    text: "We have `Claim__c.Claim_Status__c` + `Internal_Notes__c` in Salesforce and claim APIs on the fraud demo service — *not* a public customer claims journey API yet. Any ClaimTrack MVP likely needs *status model + events + mobile BFF*.",
  },
];

async function main() {
  const token = process.env.CLAIMS_FRAUD_SLACK_BOT_TOKEN;
  if (!token) throw new Error("CLAIMS_FRAUD_SLACK_BOT_TOKEN required");

  const client = new WebClient(token);
  console.log(`Posting ClaimTrack feedback thread to ${CHANNEL}…`);

  const parent = await client.chat.postMessage({
    channel: CHANNEL,
    text: THREAD_START.text,
    mrkdwn: true,
  });

  for (const reply of REPLIES) {
    await client.chat.postMessage({
      channel: CHANNEL,
      thread_ts: parent.ts,
      text: `*${reply.userLabel}:* ${reply.text}`,
      mrkdwn: true,
    });
    await new Promise((r) => setTimeout(r, 400));
  }

  await client.chat.postMessage({
    channel: CHANNEL,
    thread_ts: parent.ts,
    text:
      ":clipboard: *For spec challenge:* search Jira `MAR` labels `claimtrack` / `business-feedback`, GitHub `marshmallow` docs under `docs/product/`, Confluence *ClaimTrack* pages in space SD.",
  });

  console.log(`Done. Thread ts: ${parent.ts}`);
  console.log(`Slack archive: https://slack.com/archives/${CHANNEL}/p${parent.ts.replace(".", "")}`);
}

main().catch((err) => {
  console.error(err.message || err);
  if (String(err.message).includes("not_in_channel")) {
    console.error("\nInvite bot: /invite @Claims Fraud Agent in #business-feedback");
  }
  process.exit(1);
});
