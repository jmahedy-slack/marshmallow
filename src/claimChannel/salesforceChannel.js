const { WebClient } = require("@slack/web-api");
const config = require("../config");

const SLACK_CHANNEL_NOTE_RE =
  /\[Claims Fraud Agent\]\s*Salesforce Slack channel:\s*#?([^\s(]+)\s*\((C[A-Z0-9]+)\)/i;

function parseSlackChannelFromNotes(notes) {
  if (!notes) return null;
  const match = String(notes).match(SLACK_CHANNEL_NOTE_RE);
  if (!match) return null;
  return {
    channelName: match[1],
    channelId: match[2],
    source: "salesforce_claim_notes",
  };
}

function buildSlackChannelNote({ channelName, channelId, teamId }) {
  const archive = teamId
    ? `https://app.slack.com/client/${teamId}/${channelId}`
    : `slack://channel?id=${channelId}`;
  return `[Claims Fraud Agent] Salesforce Slack channel: #${channelName} (${channelId}) — ${archive}`;
}

function getAdminClient(token) {
  const userToken = token || config.slackUserToken;
  if (!userToken) return null;
  return new WebClient(userToken);
}

async function callAdminApi(adminClient, method, args) {
  const result = await adminClient.apiCall(method, args);
  if (!result.ok) {
    const err = new Error(result.error || `${method} failed`);
    err.data = result;
    throw err;
  }
  return result;
}

async function createSalesforceChannelForRecord(recordId, options = {}) {
  const adminClient = getAdminClient(options.token);
  if (!adminClient) {
    return {
      ok: false,
      reason: "missing_user_token",
      message:
        "Set CLAIMS_FRAUD_SLACK_USER_TOKEN (xoxp- with admin.conversations:manage_objects) to create Salesforce-linked channels.",
    };
  }

  const orgId = options.orgId || config.salesforceOrgId;

  try {
    const result = await callAdminApi(adminClient, "admin.conversations.createForObjects", {
      object_id: recordId,
      salesforce_org_id: orgId,
      invite_object_team: options.inviteTeam !== false,
    });
    return {
      ok: true,
      channelId: result.channel_id,
      created: true,
      type: "salesforce_channel",
    };
  } catch (err) {
    if (err.data?.error === "channel_already_exists" && err.data?.channel_id) {
      return {
        ok: true,
        channelId: err.data.channel_id,
        existing: true,
        type: "salesforce_channel",
      };
    }
    if (err.data?.error === "channel_already_exists") {
      return {
        ok: false,
        reason: "channel_already_exists",
        message: "This Claim__c is already linked to a different Salesforce channel.",
        data: err.data,
      };
    }
    throw err;
  }
}

async function linkSlackChannelToRecord(channelId, recordId, options = {}) {
  const adminClient = getAdminClient(options.token);
  if (!adminClient) {
    return { ok: false, reason: "missing_user_token" };
  }

  const orgId = options.orgId || config.salesforceOrgId;

  try {
    await callAdminApi(adminClient, "admin.conversations.linkObjects", {
      channel: channelId,
      record_id: recordId,
      salesforce_org_id: orgId,
    });
    return { ok: true, linked: true, channelId, type: "salesforce_channel" };
  } catch (err) {
    if (err.data?.error === "record_channel_already_exists" && err.data?.channel_id) {
      return {
        ok: true,
        existing: true,
        channelId: err.data.channel_id,
        type: "salesforce_channel",
      };
    }
    throw err;
  }
}

async function inviteUsersToChannelAdmin(channelId, userIds, options = {}) {
  const adminClient = getAdminClient(options.token);
  if (!adminClient) return { ok: false, reason: "missing_user_token" };

  const ids = (Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean);
  if (!ids.length) return { ok: false, reason: "no_users" };

  try {
    await callAdminApi(adminClient, "admin.conversations.invite", {
      channel_id: channelId,
      user_ids: ids,
    });
    return { ok: true, invited: ids };
  } catch (err) {
    if (err.data?.error === "already_in_channel") {
      return { ok: true, alreadyInChannel: true };
    }
    return { ok: false, error: err.message, data: err.data };
  }
}

module.exports = {
  SLACK_CHANNEL_NOTE_RE,
  parseSlackChannelFromNotes,
  buildSlackChannelNote,
  getAdminClient,
  createSalesforceChannelForRecord,
  linkSlackChannelToRecord,
  inviteUsersToChannelAdmin,
};
