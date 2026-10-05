const config = require("../config");
const {
  parseSlackChannelFromNotes,
  createSalesforceChannelForRecord,
} = require("./salesforceChannel");
const { fetchClaimFromSalesforce, fetchClaimIdBySlackChannelId } = require("../salesforce/claim");
const { listClaims } = require("../engine/store");

function claimIdToChannelName(claimId) {
  return String(claimId || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 78);
}

function claimIdFromChannelName(channelName) {
  const name = String(channelName || "").toLowerCase().replace(/\s+/g, "");
  if (!name) return null;
  if (name.startsWith("clm-")) return `CLM-${name.slice(4)}`.toUpperCase();
  if (name.startsWith("clm") && /^clm\d{4,}$/.test(name)) return `CLM-${name.slice(3)}`.toUpperCase();
  const embedded = name.match(/(?:^|[-_])clm-?([0-9]{4,})/i);
  if (embedded) return `CLM-${embedded[1]}`.toUpperCase();
  return null;
}

function claimIdFromChannelMeta(channel) {
  if (!channel) return null;
  const fromName = claimIdFromChannelName(channel.name);
  if (fromName) return fromName;

  const text = [channel.topic?.value, channel.purpose?.value].filter(Boolean).join(" ");
  const match = text.match(/\b(CLM-[0-9]{4,})\b/i);
  return match ? match[1].toUpperCase() : null;
}

function claimIdFromLocalNotes(channelId) {
  if (!channelId) return null;
  for (const claim of listClaims()) {
    const notes = claim.internalNotes || claim.fraudNotes || "";
    const linked = parseSlackChannelFromNotes(notes);
    if (linked?.channelId === channelId) return claim.id;
    if (notes.includes(`(${channelId})`)) return claim.id;
  }
  return null;
}

async function resolveClaimIdForChannel(client, channelId, cache, logger) {
  if (cache?.has(channelId)) return cache.get(channelId);

  let claimId = null;
  let channelName = channelId;

  try {
    const info = await client.conversations.info({ channel: channelId });
    channelName = info.channel?.name || channelId;
    claimId = claimIdFromChannelMeta(info.channel);
  } catch (err) {
    logger?.debug?.(`resolveClaimIdForChannel: conversations.info failed for ${channelId}`, err.message);
  }

  if (!claimId) {
    claimId = claimIdFromLocalNotes(channelId);
    if (claimId) {
      logger?.info?.(`Claim channel watch: matched ${claimId} via local notes for #${channelName}`);
    }
  }

  if (!claimId && config.salesforceEnabled) {
    const sf = await fetchClaimIdBySlackChannelId(channelId);
    if (sf.linked && sf.claimId) {
      claimId = sf.claimId;
      logger?.info?.(`Claim channel watch: matched ${claimId} via Salesforce notes for #${channelName}`);
    }
  }

  if (cache) cache.set(channelId, claimId);
  return claimId;
}

async function listWorkspaceChannels(client) {
  const channels = [];
  let cursor;

  do {
    const res = await client.conversations.list({
      types: "public_channel,private_channel",
      exclude_archived: true,
      limit: 200,
      cursor,
    });
    channels.push(...(res.channels || []));
    cursor = res.response_metadata?.next_cursor;
  } while (cursor);

  return channels;
}

async function findClaimChannelByName(client, claimId) {
  if (!client || !claimId) return null;

  const targetName = claimIdToChannelName(claimId);
  if (!targetName) return null;

  const channels = await listWorkspaceChannels(client);
  const match = channels.find((c) => c.name === targetName);
  if (!match) return null;

  return {
    id: match.id,
    name: match.name,
    source: "slack_name_match",
  };
}

async function findClaimChannelForRecord(client, claimId) {
  if (!claimId) return null;

  const sf = await fetchClaimFromSalesforce(claimId);
  const claim = sf?.record;

  if (claim?.internalNotes) {
    const linked = parseSlackChannelFromNotes(claim.internalNotes);
    if (linked?.channelId) {
      return {
        id: linked.channelId,
        name: linked.channelName || claimIdToChannelName(claimId),
        source: "salesforce_record",
        salesforceId: claim.salesforceId,
      };
    }
  }

  if (client) {
    const byName = await findClaimChannelByName(client, claimId);
    if (byName) return byName;
  }

  return null;
}

module.exports = {
  claimIdToChannelName,
  claimIdFromChannelName,
  claimIdFromChannelMeta,
  resolveClaimIdForChannel,
  findClaimChannelByName,
  findClaimChannelForRecord,
  listWorkspaceChannels,
};
