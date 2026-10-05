const fs = require("fs");
const path = require("path");
const { WebClient } = require("@slack/web-api");
const config = require("../config");
const { enrichClaimAlert } = require("./formatAlert");

const BATCH_PATH = path.join(__dirname, "..", "..", "data", "fraud_claims_batch.json");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function channelInviteHelp(channel) {
  return (
    `Claims Fraud Agent is not in channel ${channel} (not_in_channel).\n` +
    "Invite it once in Slack:\n" +
    "  /invite @Claims Fraud Agent"
  );
}

function loadBatchClaims() {
  if (!fs.existsSync(BATCH_PATH)) {
    throw new Error(
      `No batch claims found at ${BATCH_PATH}. Run: node scripts/seed_fraud_claims_batch.js`
    );
  }
  const data = JSON.parse(fs.readFileSync(BATCH_PATH, "utf8"));
  return data.claims || [];
}

async function postSuspectClaimAlert(client, channel, claim, { pauseMs = 400 } = {}) {
  const alert = enrichClaimAlert(claim);

  let parent;
  try {
    parent = await client.chat.postMessage({
      channel,
      text: alert.text,
      blocks: alert.blocks,
      unfurl_links: true,
      unfurl_media: false,
      metadata: {
        event_type: "claims_fraud_suspect_alert",
        event_payload: alert.payload,
      },
    });
  } catch (err) {
    if (err.data?.error === "not_in_channel") {
      throw new Error(channelInviteHelp(channel));
    }
    throw err;
  }

  if (pauseMs > 0) {
    await sleep(pauseMs);
  }

  return {
    ts: parent.ts,
    claimId: claim.id,
    salesforceUrl: claim.salesforceUrl,
    agentPrompt: alert.agentPrompt,
    payload: alert.payload,
  };
}

async function publishSuspectClaimAlerts(options = {}) {
  const token = options.token || config.slackBotToken;
  const channel = options.channel || config.claimsAlertChannel;

  if (!token) {
    throw new Error("CLAIMS_FRAUD_SLACK_BOT_TOKEN is not set in .env");
  }
  if (!channel) {
    throw new Error("CLAIMS_ALERT_CHANNEL is not set (expected C0BAU8WGJA0).");
  }

  const claims = options.claims || loadBatchClaims();
  if (!claims.length) {
    throw new Error("No suspect claims found to publish.");
  }

  const limit = options.limit && options.limit > 0 ? options.limit : claims.length;
  const target = claims.slice(0, limit);
  const client = new WebClient(token);
  const posted = [];

  for (const claim of target) {
    posted.push(await postSuspectClaimAlert(client, channel, claim, options));
  }

  return { channel, count: posted.length, posted };
}

module.exports = {
  BATCH_PATH,
  loadBatchClaims,
  postSuspectClaimAlert,
  publishSuspectClaimAlerts,
};
