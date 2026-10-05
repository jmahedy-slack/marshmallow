const { runAnalysis } = require("../engine/analyze");
const { readChannelContext } = require("../engine/channelContext");
const { setChannelSession } = require("../engine/channelSession");
const { buildStopBlocks, titleForResult } = require("../blocks/formatResponse");
const { createInvestigationCase, fetchClaimFromSalesforce, putClaimOnHold, releaseClaimFromHold } = require("../salesforce/claim");
const { listPatterns } = require("../engine/store");
const { channelSelectBlocks } = require("../assistant");
const {
  parseHoldActionSeed,
  replaceHoldCardInBlocks,
  isHoldStatusBlock,
} = require("../blocks/claimHoldStatusCard");
const {
  createClaimChannel,
  parseCreateChannelSeed,
} = require("../claimChannel/create");

const CHANNEL_CREATION_SCOPES = [
  "channels:manage",
  "channels:join",
  "pins:write",
  "canvases:write",
];

function scopeReinstallHint(err) {
  if (err?.data?.error !== "missing_scope") return "";
  const needed = err.data?.needed || CHANNEL_CREATION_SCOPES.join(", ");
  return (
    ` Reinstall the app from slack-manifest.json and update CLAIMS_FRAUD_SLACK_BOT_TOKEN ` +
    `(missing: ${needed}).`
  );
}

function isCreateChannelActionBlock(block) {
  return (
    block?.type === "actions" &&
    block.elements?.some((el) => el.action_id?.startsWith("claims_create_channel_"))
  );
}

function blocksWithoutCreateButton(blocks) {
  return (blocks || []).filter((block) => !isCreateChannelActionBlock(block));
}

async function setAssistantThreadStatus(client, channelId, threadTs, status) {
  if (!channelId || !threadTs || !client?.assistant?.threads?.setStatus) return;
  try {
    await client.assistant.threads.setStatus({
      channel_id: channelId,
      thread_ts: threadTs,
      status,
    });
  } catch {
    // Assistant status is best-effort for button feedback.
  }
}

async function updateSourceMessage({ client, body, text, blocks }) {
  const channel = body.channel?.id;
  const ts = body.message?.ts;
  if (!channel || !ts) return false;

  try {
    await client.chat.update({
      channel,
      ts,
      text: text || " ",
      ...(blocks ? { blocks } : {}),
    });
    return true;
  } catch {
    return false;
  }
}

async function replyEphemeral({ respond, client, userId, channelId, text, blocks }) {
  const payload = {
    response_type: "ephemeral",
    text: text || " ",
  };
  if (blocks) payload.blocks = blocks;

  if (typeof respond === "function") {
    try {
      await respond(payload);
      return;
    } catch {
      // Fall through to postEphemeral / postMessage.
    }
  }

  if (client && channelId && userId) {
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: text || " ",
      ...(blocks ? { blocks } : {}),
    });
  }
}

function isHoldActionBlock(block) {
  if (isHoldStatusBlock(block)) return true;
  if (block?.type === "actions") {
    return block.elements?.some(
      (el) =>
        el.action_id?.startsWith("claims_put_on_hold_") ||
        el.action_id?.startsWith("claims_release_from_hold_")
    );
  }
  return (
    block?.type === "card" &&
    block.block_id?.startsWith("claim-hold-") &&
    block.actions?.some((el) => el.action_id?.startsWith("claims_put_on_hold_"))
  );
}

function blocksWithoutHoldButton(blocks) {
  return (blocks || []).filter(
    (block) => !isHoldActionBlock(block) && !isHoldStatusBlock(block)
  );
}

function registerActions(app) {
  app.action("claims_channel_select", async ({ action, body, ack, client, respond, logger }) => {
    await ack();
    const channelKey = action.selected_option?.value;
    const threadTs = body.container?.thread_ts || body.message?.thread_ts;
    const slackChannelId = body.channel?.id;

    if (!channelKey || !slackChannelId || !threadTs) {
      await respond({
        response_type: "ephemeral",
        text: ":warning: Could not attach channel context to this thread.",
      });
      return;
    }

    try {
      const channelContext = await readChannelContext({ client, channelKey });
      setChannelSession(slackChannelId, threadTs, { channelKey, channelContext });

      await respond({
        response_type: "ephemeral",
        text:
          `:white_check_mark: Claims channel set to *${channelContext?.label || channelKey}* ` +
          `(${channelContext?.messageCount || 0} messages, ${channelContext?.fileCount || 0} files).\n` +
          "Ask me to review a claim reference — e.g. `Review claim CLM-2026-004781`.",
      });
    } catch (err) {
      logger.error(err);
      await respond({
        response_type: "ephemeral",
        text: `:warning: Could not read channel context: ${err.message}`,
      });
    }
  });

  app.action(/^claims_feedback_/, async ({ action, body, ack, client, logger }) => {
    await ack();
    try {
      await client.chat.postEphemeral({
        channel: body.channel?.id,
        user: body.user?.id,
        text:
          action.value === "positive"
            ? "Thanks for the feedback."
            : "Sorry this wasn't helpful — we'll tune profiling rules.",
      });
    } catch (err) {
      logger.error(err);
    }
  });

  app.action(/^claims_create_channel_/, async ({ action, body, ack, respond, client, logger }) => {
    const userId = body.user?.id;
    const sourceChannelId = body.channel?.id;
    const sourceThreadTs =
      body.container?.thread_ts || body.message?.thread_ts || body.message?.ts;
    const seed = parseCreateChannelSeed(action.value);
    const claimId = seed?.claimId || "claim";

    await ack();
    logger.info(`Create channel button clicked for ${claimId} by ${userId || "unknown"}`);

    const progressText = `:hourglass_flowing_sand: Creating Salesforce channel for *${claimId}*…`;
    const progressBlocks = [
      ...blocksWithoutCreateButton(body.message?.blocks),
      {
        type: "section",
        text: { type: "mrkdwn", text: progressText },
      },
    ];

    await setAssistantThreadStatus(
      client,
      sourceChannelId,
      sourceThreadTs,
      "Creating Salesforce channel…"
    );
    await updateSourceMessage({
      client,
      body,
      text: `Creating Salesforce channel for ${claimId}…`,
      blocks: progressBlocks,
    });

    if (!sourceChannelId || !userId) {
      await setAssistantThreadStatus(client, sourceChannelId, sourceThreadTs, "");
      await replyEphemeral({
        respond,
        client,
        userId,
        channelId: sourceChannelId,
        text: ":warning: Could not determine where to create the claim channel from.",
      });
      return;
    }

    try {
      const claimChannel = await createClaimChannel({
        client,
        userId,
        sourceChannelId,
        sourceThreadTs,
        seed,
        teamId: body.team?.id,
        logger,
      });

      const successText =
        `:white_check_mark: *Salesforce channel ${claimChannel.existing ? "opened" : "created"}:* <#${claimChannel.channelId}>\n` +
        `• Linked to Claim__c \`${claimChannel.claim?.id}\`${claimChannel.salesforceLinked ? " (Salesforce Channels)" : ""}\n` +
        `• Claims Fraud Agent invited to channel\n` +
        `• Investigation brief pinned\n` +
        `• Channel canvas populated\n` +
        (claimChannel.claim?.salesforceUrl
          ? `• <${claimChannel.claim.salesforceUrl}|Salesforce Claim__c ${claimChannel.claim.id}>\n`
          : "") +
        (claimChannel.sourceLink ? `• <${claimChannel.sourceLink}|Original agent thread>\n` : "") +
        (claimChannel.warning ? `• :warning: ${claimChannel.warning}` : "");

      const successBlocks = [
        ...blocksWithoutCreateButton(body.message?.blocks),
        {
          type: "section",
          text: { type: "mrkdwn", text: successText },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Open claim channel" },
              url: `slack://channel?id=${claimChannel.channelId}&team=${body.team?.id || ""}`,
            },
            ...(claimChannel.claim?.salesforceUrl
              ? [
                  {
                    type: "button",
                    text: { type: "plain_text", text: "Open Salesforce claim" },
                    url: claimChannel.claim.salesforceUrl,
                  },
                ]
              : []),
          ],
        },
      ];

      const updated = await updateSourceMessage({
        client,
        body,
        text: `Claim channel created: #${claimChannel.channelName}`,
        blocks: successBlocks,
      });

      if (!updated) {
        await client.chat.postMessage({
          channel: sourceChannelId,
          thread_ts: sourceThreadTs,
          text: `Claim channel created: #${claimChannel.channelName}`,
          blocks: successBlocks,
        });
      }

      await replyEphemeral({
        respond,
        client,
        userId,
        channelId: sourceChannelId,
        text: `Claim channel ready: #${claimChannel.channelName}`,
      });
    } catch (err) {
      logger.error(err);
      const userHint = scopeReinstallHint(err);
      const sfHint =
        err.data?.error === "missing_scope" && String(err.data?.needed || "").includes("admin")
          ? " Set CLAIMS_FRAUD_SLACK_USER_TOKEN for Salesforce-linked channels."
          : "";
      const errorText =
        `:warning: Could not create claim channel: ${err.message || err.data?.error || "unknown error"}.` +
        userHint +
        sfHint;

      await updateSourceMessage({
        client,
        body,
        text: errorText,
        blocks: [
          ...blocksWithoutCreateButton(body.message?.blocks),
          {
            type: "section",
            text: { type: "mrkdwn", text: errorText },
          },
        ],
      });

      await replyEphemeral({
        respond,
        client,
        userId,
        channelId: sourceChannelId,
        text: errorText,
      });
    } finally {
      await setAssistantThreadStatus(client, sourceChannelId, sourceThreadTs, "");
    }
  });

  app.action(/^claims_put_on_hold_/, async ({ action, body, ack, respond, client, logger }) => {
    const userId = body.user?.id;
    const channelId = body.channel?.id;
    const threadTs = body.container?.thread_ts || body.message?.thread_ts || body.message?.ts;
    const seed = parseHoldActionSeed(action.value);
    const claimId = seed.claimId || "claim";

    await ack();
    logger.info(`Put on hold clicked for ${claimId} by ${userId || "unknown"}`);

    const retainedBlocks = blocksWithoutHoldButton(body.message?.blocks);
    const progressBlocks = [
      {
        type: "section",
        block_id: `claim-hold-progress-${Date.now()}`,
        text: {
          type: "mrkdwn",
          text: `:hourglass_flowing_sand: Applying fraud hold for *${claimId}*…`,
        },
      },
      ...retainedBlocks,
    ];

    await updateSourceMessage({
      client,
      body,
      text: `Applying fraud hold for ${claimId}…`,
      blocks: progressBlocks,
    });

    try {
      let salesforceId = seed.salesforceId;
      if (!salesforceId) {
        const sf = await fetchClaimFromSalesforce(claimId);
        salesforceId = sf.record?.salesforceId;
      }

      const result = await putClaimOnHold({
        salesforceId,
        claimId,
        ruleId: seed.ruleId,
        initiatedBy: body.user?.username || userId,
      });

      if (!result.updated) {
        throw new Error(result.error || "Could not update claim in Salesforce");
      }

      const pattern = listPatterns().find((p) => p.id === seed.ruleId);
      const successBlocks = replaceHoldCardInBlocks(retainedBlocks, {
        claimId,
        held: true,
        ruleId: seed.ruleId,
        ruleName: pattern?.name,
        salesforceId,
        messageTs: body.message?.ts,
      });

      await updateSourceMessage({
        client,
        body,
        text: `Claim ${claimId} on hold`,
        blocks: successBlocks,
      });
    } catch (err) {
      logger.error(err);
      const errorText = `:warning: Could not put claim on hold: ${err.message || err.data?.error || "unknown error"}`;

      await updateSourceMessage({
        client,
        body,
        text: errorText,
        blocks: [
          ...blocksWithoutHoldButton(body.message?.blocks),
          {
            type: "section",
            text: { type: "mrkdwn", text: errorText },
          },
        ],
      });

      await replyEphemeral({
        respond,
        client,
        userId,
        channelId,
        text: errorText,
      });
    }
  });

  app.action(/^claims_release_from_hold_/, async ({ action, body, ack, respond, client, logger }) => {
    const userId = body.user?.id;
    const channelId = body.channel?.id;
    const seed = parseHoldActionSeed(action.value);
    const claimId = seed.claimId || "claim";

    await ack();
    logger.info(`Release from hold clicked for ${claimId} by ${userId || "unknown"}`);

    const retainedBlocks = blocksWithoutHoldButton(body.message?.blocks);
    const progressBlocks = [
      {
        type: "section",
        block_id: `claim-hold-progress-${Date.now()}`,
        text: {
          type: "mrkdwn",
          text: `:hourglass_flowing_sand: Releasing hold for *${claimId}*…`,
        },
      },
      ...retainedBlocks,
    ];

    await updateSourceMessage({
      client,
      body,
      text: `Releasing hold for ${claimId}…`,
      blocks: progressBlocks,
    });

    try {
      let salesforceId = seed.salesforceId;
      if (!salesforceId) {
        const sf = await fetchClaimFromSalesforce(claimId);
        salesforceId = sf.record?.salesforceId;
      }

      const result = await releaseClaimFromHold({
        salesforceId,
        claimId,
        ruleId: seed.ruleId,
        initiatedBy: body.user?.username || userId,
      });

      if (!result.updated) {
        throw new Error(result.error || "Could not update claim in Salesforce");
      }

      const pattern = listPatterns().find((p) => p.id === seed.ruleId);
      const successBlocks = replaceHoldCardInBlocks(retainedBlocks, {
        claimId,
        held: false,
        ruleId: seed.ruleId,
        ruleName: pattern?.name,
        salesforceId,
        messageTs: body.message?.ts,
      });

      await updateSourceMessage({
        client,
        body,
        text: `Claim ${claimId} released from hold`,
        blocks: successBlocks,
      });
    } catch (err) {
      logger.error(err);
      const errorText = `:warning: Could not release claim: ${err.message || err.data?.error || "unknown error"}`;

      await updateSourceMessage({
        client,
        body,
        text: errorText,
        blocks: [
          ...blocksWithoutHoldButton(body.message?.blocks),
          {
            type: "section",
            text: { type: "mrkdwn", text: errorText },
          },
        ],
      });

      await replyEphemeral({
        respond,
        client,
        userId,
        channelId,
        text: errorText,
      });
    }
  });

  app.action(/^claims_sf_case_/, async ({ action, body, ack, respond, logger }) => {
    await ack();
    try {
      const payload = JSON.parse(action.value || "{}");
      const sfCase = await createInvestigationCase(payload);
      if (sfCase.created) {
        await respond({
          response_type: "ephemeral",
          text: `:white_check_mark: <${sfCase.url}|Case ${sfCase.caseNumber}> created in Salesforce.`,
        });
      } else {
        await respond({
          response_type: "ephemeral",
          text: `:warning: Could not create case: ${sfCase.error || sfCase.note}`,
        });
      }
    } catch (err) {
      logger.error(err);
    }
  });
}

function registerCommands(app) {
  app.command("/claims-review", async ({ command, ack, client, logger }) => {
    await ack();
    const text = (command.text || "").trim();
    if (!text) {
      await client.chat.postEphemeral({
        channel: command.channel_id,
        user: command.user_id,
        text: "Usage: `/claims-review CLM-2026-004781`",
      });
      return;
    }
    try {
      const result = await runAnalysis(`review claim ${text}`, {
        client,
        persistToSalesforce: true,
      });
      await client.chat.postEphemeral({
        channel: command.channel_id,
        user: command.user_id,
        blocks: buildStopBlocks(result, `cmd_${Date.now()}`),
        text: titleForResult(result),
      });
    } catch (err) {
      logger.error(err);
    }
  });

  app.command("/claims-rules", async ({ command, ack, client }) => {
    await ack();
    const result = await runAnalysis("list profiling rules");
    await client.chat.postEphemeral({
      channel: command.channel_id,
      user: command.user_id,
      blocks: buildStopBlocks(result, "rules"),
      text: "Profiler rules",
    });
  });

  app.command("/claims-channel", async ({ command, ack, client, logger }) => {
    await ack();
    const claimId = (command.text || "").trim().toUpperCase();
    if (!claimId || !/^CLM-[A-Z0-9-]+$/i.test(claimId)) {
      await client.chat.postEphemeral({
        channel: command.channel_id,
        user: command.user_id,
        text: "Usage: `/claims-channel CLM-0018`",
      });
      return;
    }

    try {
      const claimChannel = await createClaimChannel({
        client,
        userId: command.user_id,
        sourceChannelId: command.channel_id,
        sourceThreadTs: null,
        seed: { claimId },
        teamId: command.team_id,
        logger,
      });

      await client.chat.postEphemeral({
        channel: command.channel_id,
        user: command.user_id,
        text: `Salesforce channel ${claimChannel.existing ? "opened" : "created"}: #${claimChannel.channelName}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text:
                `:white_check_mark: *Salesforce channel ${claimChannel.existing ? "opened" : "created"}:* <#${claimChannel.channelId}>\n` +
                `Linked to Claim__c \`${claimChannel.claim?.id}\`${claimChannel.salesforceLinked ? " (Salesforce Channels)" : ""}` +
                (claimChannel.warning ? `\n:warning: ${claimChannel.warning}` : ""),
            },
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "Open claim channel" },
                url: `slack://channel?id=${claimChannel.channelId}&team=${command.team_id || ""}`,
              },
              ...(claimChannel.claim?.salesforceUrl
                ? [
                    {
                      type: "button",
                      text: { type: "plain_text", text: "Open Salesforce claim" },
                      url: claimChannel.claim.salesforceUrl,
                    },
                  ]
                : []),
            ],
          },
        ],
      });
    } catch (err) {
      logger.error(err);
      const hint = scopeReinstallHint(err);
      await client.chat.postEphemeral({
        channel: command.channel_id,
        user: command.user_id,
        text:
          `:warning: Could not create claim channel: ${err.message || err.data?.error || "unknown error"}.${hint}`,
      });
    }
  });
}

function registerMentions(app) {
  app.event("app_mention", async ({ event, client, logger }) => {
    const channel = event.channel;
    const threadTs = event.thread_ts || event.ts;
    const text = (event.text || "").replace(/<@[^>]+>/g, "").trim();
    try {
      await client.assistant.threads.setStatus({
        channel_id: channel,
        thread_ts: threadTs,
        status: "Profiling claim…",
      });
      const result = await runAnalysis(text || "list profiling rules", {
        client,
        persistToSalesforce: true,
      });
      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: titleForResult(result),
        blocks: buildStopBlocks(result, `mention_${event.ts}`),
      });
      await client.assistant.threads.setStatus({ channel_id: channel, thread_ts: threadTs, status: "" });
    } catch (err) {
      logger.error(err);
      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: ":warning: Could not complete claims profiling.",
      });
    }
  });
}

module.exports = { registerActions, registerCommands, registerMentions };
