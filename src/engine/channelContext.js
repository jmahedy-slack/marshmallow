const { loadData } = require("./store");

const FRAUD_KEYWORDS = /\b(siu|suspect|fraud|exif|metadata|hold|investigation|staged|flagged)\b/i;

function getSeededChannelContext(channelKey) {
  const { channelSeeds, claimChannels } = loadData();
  const seed = channelSeeds[channelKey];
  if (!seed) return null;
  const meta = claimChannels.find((c) => c.id === channelKey);
  return {
    channelId: channelKey,
    channelName: meta?.name || channelKey,
    label: meta?.label || channelKey,
    source: "seed",
    messages: seed.messages || [],
    files: seed.files || [],
    messageCount: (seed.messages || []).length,
    fileCount: (seed.files || []).length,
  };
}

async function fetchLiveChannelHistory(client, channelId, limit = 100) {
  if (!client || !channelId) return null;
  try {
    const history = await client.conversations.history({
      channel: channelId,
      limit,
    });
    const messages = (history.messages || [])
      .filter((m) => m.text)
      .map((m) => ({
        user: m.user || m.bot_id || "unknown",
        text: m.text,
        ts: m.ts,
      }))
      .reverse();

    const files = [];
    for (const m of history.messages || []) {
      if (m.files?.length) {
        for (const f of m.files) {
          files.push({
            id: f.id,
            name: f.name || f.title || "file",
            mimetype: f.mimetype,
            size: f.size,
            url: f.url_private || f.permalink || "",
            note: f.preview || f.initial_comment?.comment || "",
          });
        }
      }
    }

    let channelName = channelId;
    try {
      const info = await client.conversations.info({ channel: channelId });
      channelName = info.channel?.name || channelId;
    } catch {
      // non-fatal
    }

    return {
      channelId,
      channelName,
      label: `#${channelName}`,
      source: "slack_api",
      messages,
      files,
      messageCount: messages.length,
      fileCount: files.length,
    };
  } catch (err) {
    return { error: err.message || String(err), channelId, source: "slack_api" };
  }
}

async function readChannelContext({ client, channelKey, channelId }) {
  const key = channelKey || channelId;
  if (channelId && client && !String(channelId).startsWith("C_CLAIMS_")) {
    const live = await fetchLiveChannelHistory(client, channelId);
    if (live && !live.error) return live;
  }
  if (key) {
    const seeded = getSeededChannelContext(key);
    if (seeded) return seeded;
  }
  if (channelId) {
    const seededById = getSeededChannelContext(channelId);
    if (seededById) return seededById;
  }
  return null;
}

function extractClaimRefsFromContext(channelContext) {
  if (!channelContext?.messages) return [];
  const refs = new Set();
  const re = /\b(CLM-(?:\d{4}-\d{6}|\d{4}))\b/gi;
  for (const m of channelContext.messages) {
    let match;
    while ((match = re.exec(m.text)) !== null) {
      refs.add(match[1].toUpperCase());
    }
  }
  return [...refs];
}

function summarizeChannelForDisplay(ctx, claimChannelMeta) {
  if (claimChannelMeta?.found === false && claimChannelMeta?.searchedName) {
    return (
      `:mag: No *Salesforce channel* linked to this Claim__c (expected \`#${claimChannelMeta.searchedName}\`).\n` +
      `_Tap **Create Salesforce channel** in suggested prompts, or type \`Create channel for …\`_`
    );
  }
  if (!ctx) return "_No claims channel context available._";

  const lines = [];
  if (ctx.matchType === "salesforce_claim_channel") {
    lines.push(`*Salesforce claim channel:* #${ctx.channelName} (linked to Claim__c)`);
  } else if (ctx.matchType === "claim_channel") {
    lines.push(`*Claim channel:* #${ctx.channelName} (auto-matched)`);
  } else {
    lines.push(`*Channel:* ${ctx.label || ctx.channelName}`);
  }
  lines.push(`*Messages:* ${ctx.messageCount} · *Files:* ${ctx.fileCount}`);
  if (ctx.error) lines.push(`:warning: Live read failed: ${ctx.error}`);
  const refs = extractClaimRefsFromContext(ctx);
  if (refs.length) lines.push(`*Claim refs in channel:* ${refs.join(", ")}`);
  if (ctx.files?.length) {
    lines.push("*Files:* " + ctx.files.map((f) => f.name).join(", "));
  }
  if (ctx.messages?.length) {
    const preview = ctx.messages
      .slice(-3)
      .map((m) => `> ${m.text.slice(0, 120)}`)
      .join("\n");
    lines.push("*Recent context:*\n" + preview);
  }
  return lines.join("\n");
}

function channelFraudSignals(ctx, claimId) {
  if (!ctx?.messages) return [];
  const needle = (claimId || "").toUpperCase();
  const signals = [];
  for (const m of ctx.messages) {
    const upper = m.text.toUpperCase();
    if (needle && !upper.includes(needle)) continue;
    if (FRAUD_KEYWORDS.test(m.text)) {
      signals.push({
        user: m.user,
        text: m.text.slice(0, 200),
        ts: m.ts,
      });
    }
  }
  return signals;
}

module.exports = {
  readChannelContext,
  getSeededChannelContext,
  extractClaimRefsFromContext,
  summarizeChannelForDisplay,
  channelFraudSignals,
};
