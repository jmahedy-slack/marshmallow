const { claimIdToChannelName } = require("./resolve");
const {
  buildClaimPinBlocks,
  buildClaimPinText,
  buildClaimCanvasMarkdown,
  slackArchiveLink,
} = require("./format");
const {
  createSalesforceChannelForRecord,
  linkSlackChannelToRecord,
  inviteUsersToChannelAdmin,
} = require("./salesforceChannel");
const { runAnalysis } = require("../engine/analyze");
const { linkSlackChannelToClaim } = require("../salesforce/claim");
const { createChannelCanvas } = require("./canvas");
const { buildClaimFeedImageCarouselPart } = require("../slack/claimImageCarousel");

async function getUserLabel(client, userId) {
  try {
    const res = await client.users.info({ user: userId });
    return (
      res.user?.profile?.display_name ||
      res.user?.profile?.real_name ||
      res.user?.name ||
      userId
    );
  } catch {
    return userId;
  }
}

async function fetchThreadTranscript(client, channelId, threadTs) {
  if (!channelId || !threadTs) return [];

  const res = await client.conversations.replies({
    channel: channelId,
    ts: threadTs,
    limit: 200,
  });

  const cache = new Map();
  const transcript = [];

  for (const msg of res.messages || []) {
    if (!msg.text) continue;
    const text = msg.text.replace(/<@[^>]+>/g, "@user").trim();
    if (!text) continue;

    let user = "System";
    if (msg.user) {
      try {
        if (!cache.has(msg.user)) {
          const info = await client.users.info({ user: msg.user });
          cache.set(
            msg.user,
            info.user?.profile?.display_name ||
              info.user?.profile?.real_name ||
              info.user?.name ||
              msg.user
          );
        }
        user = cache.get(msg.user);
      } catch {
        user = msg.user;
      }
    } else if (msg.bot_id || msg.app_id) {
      user = "Claims Fraud Agent";
    }

    transcript.push({ user, text, ts: msg.ts });
  }

  return transcript;
}

async function createPlainChannel(client, claimId, attempt = 0) {
  const baseName = claimIdToChannelName(claimId);
  const name =
    attempt > 0
      ? `${baseName}-${Date.now().toString(36).slice(-4)}`.slice(0, 78)
      : baseName;

  try {
    const created = await client.conversations.create({
      name,
      is_private: false,
    });
    return { channelId: created.channel.id, channelName: name, created: true };
  } catch (err) {
    if (err.data?.error === "name_taken" && attempt < 2) {
      const info = await client.conversations.list({
        types: "public_channel,private_channel",
        exclude_archived: true,
        limit: 200,
      });
      const existing = (info.channels || []).find((c) => c.name === baseName);
      if (existing) {
        return { channelId: existing.id, channelName: existing.name, existing: true };
      }
      return createPlainChannel(client, claimId, attempt + 1);
    }
    throw err;
  }
}

async function resolveSalesforceLinkedChannel(client, claim) {
  if (!claim?.salesforceId) {
    throw new Error(
      `Claim ${claim.id} must exist in Salesforce Claim__c before creating a Salesforce channel.`
    );
  }

  const sfResult = await createSalesforceChannelForRecord(claim.salesforceId, {
    inviteTeam: true,
  });

  if (sfResult.ok && sfResult.channelId) {
    return {
      channelId: sfResult.channelId,
      channelName: claimIdToChannelName(claim.id),
      existing: Boolean(sfResult.existing),
      salesforceLinked: true,
      type: "salesforce_channel",
    };
  }

  if (sfResult.reason === "missing_user_token") {
    const plain = await createPlainChannel(client, claim.id);
    const link = await linkSlackChannelToRecord(plain.channelId, claim.salesforceId);
    if (!link.ok && link.reason === "missing_user_token") {
      return {
        ...plain,
        salesforceLinked: false,
        type: "slack_channel",
        warning:
          "Created Slack channel only — add CLAIMS_FRAUD_SLACK_USER_TOKEN to link as a Salesforce channel.",
      };
    }
    return {
      ...plain,
      salesforceLinked: true,
      existing: Boolean(link.existing),
      type: "salesforce_channel",
    };
  }

  throw new Error(sfResult.message || "Could not create Salesforce channel for Claim__c");
}

let cachedBotUserId = null;

async function joinChannel(client, channelId) {
  try {
    await client.conversations.join({ channel: channelId });
    return true;
  } catch (err) {
    if (err.data?.error === "already_in_channel") return true;
    throw err;
  }
}

async function getBotUserId(client) {
  if (cachedBotUserId) return cachedBotUserId;
  const auth = await client.auth.test();
  cachedBotUserId = auth.user_id;
  return cachedBotUserId;
}

async function inviteBotToChannel(client, channelId, userId, logger) {
  const botUserId = await getBotUserId(client);

  const adminInvite = await inviteUsersToChannelAdmin(channelId, [botUserId, userId].filter(Boolean));
  if (adminInvite.ok) return { method: "admin", ...adminInvite };

  try {
    await joinChannel(client, channelId);
  } catch (err) {
    logger?.warn("Bot join channel failed", err);
  }

  if (userId && userId !== botUserId) {
    try {
      await client.conversations.invite({ channel: channelId, users: userId });
    } catch (err) {
      if (err.data?.error !== "already_in_channel") {
        logger?.warn("User invite to channel failed", err);
      }
    }
  }

  return { method: "bot" };
}

async function createOrUpdateClaimBriefCanvas(client, channelId, title, markdown) {
  try {
    return await createChannelCanvas(client, channelId, title, markdown);
  } catch (err) {
    if (err.data?.error === "channel_canvas_already_exists") {
      const { getChannelCanvasId, replaceChannelCanvas } = require("./canvas");
      const canvasId = await getChannelCanvasId(client, channelId);
      if (canvasId) {
        await replaceChannelCanvas(client, channelId, canvasId, markdown);
        return { created: false, updated: true, canvasId };
      }
      return { created: false, skipped: true };
    }
    throw err;
  }
}

async function createClaimChannel({
  client,
  userId,
  sourceChannelId,
  sourceThreadTs,
  seed,
  teamId,
  logger,
}) {
  const claimId = seed?.claimId;
  if (!claimId) throw new Error("No claim reference in create-channel request");

  logger?.info(`createClaimChannel start: ${claimId}`);

  const transcript = await fetchThreadTranscript(client, sourceChannelId, sourceThreadTs);
  logger?.info(`createClaimChannel transcript: ${transcript.length} messages`);

  const result = await runAnalysis(`review claim ${claimId}`, {
    client,
    persistToSalesforce: false,
  });
  logger?.info(`createClaimChannel analysis complete: ${claimId}`);

  const claim = result.analysis?.results?.[0]?.claim || { id: claimId };
  const createdByLabel = await getUserLabel(client, userId);
  const createdAt = new Date().toISOString();
  const sourceLink = slackArchiveLink(sourceChannelId, sourceThreadTs);

  const channel = await resolveSalesforceLinkedChannel(client, claim);
  const { channelId, channelName, existing, salesforceLinked, warning } = channel;
  logger?.info(`createClaimChannel channel resolved: #${channelName} (${channelId})`);

  await inviteBotToChannel(client, channelId, userId, logger);

  if (claim.salesforceId) {
    await linkSlackChannelToClaim({
      salesforceId: claim.salesforceId,
      channelName,
      channelId,
      teamId,
    });
  }

  const context = {
    result,
    claim,
    transcript,
    sourceLink,
    createdByLabel,
    createdAt,
    channelId,
    channelName,
    channelContext: result.channelContext,
    salesforceLinked,
  };

  const primary = result.analysis?.results?.[0];
  const welcomeBlocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `:clipboard: *Claim channel · \`${claim.id}\`* · ${claim.customerName || "—"}` +
          (primary ? ` · ${primary.score}/100 (${primary.band})` : "") +
          (claim.salesforceUrl ? `\n<${claim.salesforceUrl}|Open in Salesforce>` : "") +
          `\n_Full brief on channel canvas._` +
          (warning ? `\n:warning: ${warning}` : ""),
      },
    },
  ];

  const welcomeText = `Claim channel opened for ${claim.id}`;

  const welcome = await client.chat.postMessage({
    channel: channelId,
    text: welcomeText,
    blocks: welcomeBlocks,
  });

  try {
    const carouselPart = await buildClaimFeedImageCarouselPart({
      client,
      claimNumber: claim.id,
      salesforceId: claim.salesforceId,
      localOnly: true,
      logger,
    });
    if (carouselPart?.blocks?.length) {
      await client.chat.postMessage({
        channel: channelId,
        text: carouselPart.text || `Claim images for ${claim.id}`,
        blocks: carouselPart.blocks,
      });
      logger?.info(`createClaimChannel carousel posted: ${claim.id} (${carouselPart.text})`);
    }
  } catch (carouselErr) {
    logger?.warn(`createClaimChannel carousel failed for ${claim.id}`, carouselErr);
  }

  const pinPost = await client.chat.postMessage({
    channel: channelId,
    text: buildClaimPinText(result),
    blocks: buildClaimPinBlocks(context),
  });

  await client.pins.add({ channel: channelId, timestamp: pinPost.ts });

  const canvasMarkdown = buildClaimCanvasMarkdown(context);
  const canvas = await createOrUpdateClaimBriefCanvas(
    client,
    channelId,
    `Claim brief: ${claim.id}`,
    canvasMarkdown
  );

  logger?.info(
    `Salesforce claim channel ${existing ? "opened" : "created"}: #${channelName} (${channelId}) → Claim__c ${claim.salesforceId || claim.id}`
  );

  return {
    channelId,
    channelName,
    existing,
    salesforceLinked,
    warning,
    welcomeTs: welcome.ts,
    pinTs: pinPost.ts,
    canvas,
    result,
    sourceLink,
    claim,
  };
}

function parseCreateChannelSeed(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { claimId: raw };
  }
}

module.exports = {
  createClaimChannel,
  fetchThreadTranscript,
  parseCreateChannelSeed,
};
