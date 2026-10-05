const config = require("./config");
const express = require("express");
const path = require("path");
const fs = require("fs");
const { App, LogLevel } = require("@slack/bolt");
const { registerAssistant } = require("./assistant");
const { registerActions, registerCommands, registerMentions } = require("./handlers/interactivity");
const { registerClaimChannelWatch } = require("./handlers/claimChannelWatch");
const { runAnalysis } = require("./engine/analyze");
const { buildStopBlocks, titleForResult } = require("./blocks/formatResponse");
const {
  visionAvailable,
  visionEnabled,
  visionProviderLabel,
  useOpenAiVision,
} = require("./vision/damageAnalysis");
const { mimeForFilename } = require("./data/localClaimImages");

const PORT = config.port;
const SOCKET_MODE = config.socketMode;

const app = new App({
  token: config.slackBotToken,
  signingSecret: config.slackSigningSecret,
  socketMode: SOCKET_MODE,
  appToken: config.slackAppToken,
  logLevel: config.debug ? LogLevel.DEBUG : LogLevel.INFO,
});

registerAssistant(app);
registerActions(app);
registerCommands(app);
registerMentions(app);
registerClaimChannelWatch(app);

app.use(async ({ body, next, logger }) => {
  if (body?.type === "block_actions" && body.actions?.[0]?.action_id) {
    logger.info(`block_action received: ${body.actions[0].action_id}`);
  }
  await next();
});

const CHANNEL_CREATION_SCOPES = [
  "channels:manage",
  "channels:join",
  "pins:write",
  "canvases:write",
  "files:write",
];

const CLAIM_IMAGES_ROOT = path.join(__dirname, "..", "data", "claim_images");

async function logSlackScopeHealth(client, logger) {
  try {
    const auth = await client.auth.test();
    const scopes = new Set(auth.response_metadata?.scopes || []);
    const missing = CHANNEL_CREATION_SCOPES.filter((scope) => !scopes.has(scope));
    if (missing.length) {
      logger.warn(
        `Bot token missing scopes for claim channel creation: ${missing.join(", ")}. ` +
          "Reinstall from slack-manifest.json and update CLAIMS_FRAUD_SLACK_BOT_TOKEN."
      );
    }
    if (!config.slackUserToken) {
      logger.warn(
        "CLAIMS_FRAUD_SLACK_USER_TOKEN not set — channels will be plain Slack (#clm-...) unless user token is added."
      );
    }
  } catch (err) {
    logger.warn("Could not verify Slack token scopes", err);
  }
}

app.event("app_home_opened", async ({ event, client, logger }) => {
  try {
    await client.views.publish({
      user_id: event.user,
      view: {
        type: "home",
        blocks: [
          {
            type: "header",
            text: { type: "plain_text", text: "Marshmallow Claims Fraud" },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text:
                "Open the *Claims Fraud Agent* from the Slack top bar.\n\n" +
                "• Select a claims channel from the dropdown\n" +
                "• Review a claim reference (`CLM-...`)\n" +
                `• Linked to Salesforce *${config.salesforceClaimObject}* on org *${config.salesforceOrg}*\n` +
                "• `/claims-review CLM-2026-004781`\n" +
                "• `/claims-rules`\n" +
                "• `/claims-channel CLM-0018`\n" +
                "• In `#clm-…` claim channels the agent reacts :mm: and threads profiler suggestions on new messages",
            },
          },
        ],
      },
    });
  } catch (err) {
    logger.error(err);
  }
});

const api = express();
api.use(express.json());

api.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "marshmallow-claims-fraud-agent",
    publicBaseUrl: config.publicBaseUrl || null,
    salesforce: {
      enabled: config.salesforceEnabled,
      org: config.salesforceOrg,
      orgId: config.salesforceOrgId,
      object: config.salesforceClaimObject,
    },
  });
});

/** Public demo claim images for Slack carousel (requires CLAIMS_FRAUD_PUBLIC_BASE_URL + ngrok). */
api.get("/demo/claim-images/:folder/:filename", (req, res) => {
  const folder = path.basename(String(req.params.folder || ""));
  const filename = path.basename(String(req.params.filename || ""));
  if (!folder || !filename) {
    res.status(400).json({ ok: false, error: "folder and filename required" });
    return;
  }

  const filePath = path.join(CLAIM_IMAGES_ROOT, folder, filename);
  if (!filePath.startsWith(CLAIM_IMAGES_ROOT) || !fs.existsSync(filePath)) {
    res.status(404).json({ ok: false, error: "image not found" });
    return;
  }

  res.type(mimeForFilename(filename));
  res.sendFile(filePath);
});

api.post("/analyze", async (req, res) => {
  try {
    const text = String(req.body?.query || req.body?.text || "");
    const result = await runAnalysis(text, { persistToSalesforce: Boolean(req.body?.persist) });
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

(async () => {
  if (!config.slackBotToken || !config.slackAppToken) {
    console.warn("Slack tokens not set — HTTP API only on port", PORT);
    api.listen(PORT, () => {
      console.log(`Claims Fraud Agent API on port ${PORT} (no Slack Socket Mode)`);
    });
    return;
  }

  await app.start();
  await logSlackScopeHealth(app.client, app.logger);
  if (visionEnabled()) {
    const up = await visionAvailable();
    if (up) {
      app.logger.info(`Vision ready (${visionProviderLabel()})`);
    } else {
      app.logger.warn(
        `Vision unavailable for ${visionProviderLabel()} — damage image analysis will fail until configured`
      );
    }
    if (process.env.DYNO && !useOpenAiVision()) {
      app.logger.warn(
        "Heroku dyno detected but OpenAI vision is not active — set CLAIMS_FRAUD_VISION_PROVIDER=openai and CLAIMS_FRAUD_VISION_API_KEY"
      );
    }
  }
  api.listen(PORT, () => {
    console.log(`Marshmallow Claims Fraud Agent running (Socket Mode: ${SOCKET_MODE})`);
    console.log(
      `HTTP API on port ${PORT} — GET /health, POST /analyze | SF org ${config.salesforceOrg} (${config.salesforceOrgId})`
    );
  });
})();
