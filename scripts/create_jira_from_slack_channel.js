#!/usr/bin/env node
/**
 * Create Jira follow-up issues from a Slack incident channel.
 *
 * Usage:
 *   node scripts/create_jira_from_slack_channel.js
 *   node scripts/create_jira_from_slack_channel.js --channel=C0BBZ0ERKNU --count=4
 *
 * Env (see .env.example):
 *   CLAIMS_FRAUD_JIRA_* — Jira Cloud credentials and project
 *   CLAIMS_FRAUD_INCIDENT_SLACK_CHANNEL — default Slack channel id
 */
const config = require("../src/config");
const { createJiraIssue, isJiraConfigured } = require("../src/jira/client");

const DEFAULT_ISSUES = [
  {
    summary: "mobile-checkout: payment gateway HTTP 502 — checkout and direct debit failures (SEV1)",
    description: (ctx) =>
      [
        `Source: Slack #${ctx.channelName} (${ctx.slackUrl}) — ${ctx.incidentId}.`,
        "",
        "Symptoms: customers across Europe hitting payment failures during checkout and direct debit setup; gateway returning HTTP 502; ~22,400 failed transactions; support contacts up 240%; checkout abandonment +38%.",
        "Suspected cause: third-party payment gateway degradation in EU region; elevated API latency and health check failures.",
        "",
        "Impact: ~£52k/hour revenue; ~17,000 affected users; executive briefings every 30 minutes.",
        "Mitigation in progress: secondary payment route tested; vendor escalation active; customer comms drafted.",
      ].join("\n"),
  },
  {
    summary: "payment-api-eu-west-1: database connection pool exhaustion — payment auth timeouts",
    description: (ctx) =>
      [
        `Source: Slack #${ctx.channelName} (${ctx.slackUrl}) — SRE confirmation during ${ctx.incidentId}.`,
        "",
        "Symptoms: timeout errors on payment-api-eu-west-1; payment authorisation timeouts; transaction failure rate ~23%; API latency up 400%.",
        "Suspected cause: Postgres connection pool exhaustion; possible resource contention under incident load.",
        "",
        "Investigation: database team paged; checking for contention vs gateway-only failure; correlating query logs with 502 window.",
        "Mitigation ideas: pool sizing review, read-replica routing, circuit breaker tuning, connection proxy (PgBouncer).",
      ].join("\n"),
  },
  {
    summary: "payment-service: circuit breaker delay — gap between gateway 502s and breaker open",
    description: (ctx) =>
      [
        `Source: Slack #${ctx.channelName} (${ctx.slackUrl}) — timeline anomaly flagged in ${ctx.incidentId}.`,
        "",
        "Symptoms: first gateway HTTP 502s observed ~08:47 BST; circuit breakers opened later than expected; retry queue backing up in the interim.",
        "Suspected cause: breaker thresholds too high or health checks not aligned with gateway error rate; possible mismatch between vendor telemetry and internal monitoring.",
        "",
        "Investigation: compare Datadog/CloudWatch signals with vendor infrastructure telemetry; review breaker config and fallback route trigger criteria.",
        "Mitigation ideas: lower error-rate threshold, add synthetic payment probes, auto-failover to secondary route on sustained 502.",
      ].join("\n"),
  },
  {
    summary: "mobile-quote: vehicle enrichment / DVLA lookup timeouts — quote completion down 41%",
    description: (ctx) =>
      [
        `Source: Slack #${ctx.channelName} (${ctx.slackUrl}) — concurrent mobile app degradation during ${ctx.incidentId}.`,
        "",
        "Symptoms: quote completion rate fell 41%; API latency P95 14.8s; 2,847 failed quote requests; 6,392 affected users; support contacts +180%.",
        "Suspected cause: vehicle data enrichment service elevated timeout rates calling third-party DVLA and vehicle lookup providers.",
        "",
        "Business impact: new policy acquisition impacted; estimated lost premium ~£18k/hour.",
        "Mitigation ideas: cache warm vehicle lookups, extend timeouts with graceful degradation, fallback pricing path without live enrichment.",
      ].join("\n"),
  },
];

function parseArg(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((entry) => entry.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function parseCount() {
  const raw = parseArg("count");
  return raw ? Number(raw) : DEFAULT_ISSUES.length;
}

async function slackFetch(token, method, params = {}, { post = false } = {}) {
  const url = `https://slack.com/api/${method}`;
  const headers = { Authorization: `Bearer ${token}` };

  let response;
  if (post) {
    response = await fetch(url, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(params),
    });
  } else {
    const query = new URL(url);
    for (const [key, value] of Object.entries(params)) {
      if (value != null) query.searchParams.set(key, value);
    }
    response = await fetch(query, { headers });
  }

  return response.json();
}

async function loadChannelContext(channelId) {
  const token = config.slackBotToken;
  if (!token) throw new Error("CLAIMS_FRAUD_SLACK_BOT_TOKEN is not set");

  let info = await slackFetch(token, "conversations.info", { channel: channelId });
  if (!info.ok && info.error === "not_in_channel") {
    const joined = await slackFetch(token, "conversations.join", { channel: channelId }, { post: true });
    if (!joined.ok) throw new Error(`Could not join Slack channel ${channelId}: ${joined.error}`);
    info = await slackFetch(token, "conversations.info", { channel: channelId });
  }
  if (!info.ok) throw new Error(`Slack conversations.info failed: ${info.error}`);

  const history = await slackFetch(token, "conversations.history", {
    channel: channelId,
    limit: "30",
  });
  if (!history.ok) throw new Error(`Slack conversations.history failed: ${history.error}`);

  const incidentId =
    history.messages
      ?.map((message) => message.text || "")
      .join("\n")
      .match(/INC-\d{4}-\d{4}-\d{3}/)?.[0] || "INC-UNKNOWN";

  return {
    channelId,
    channelName: info.channel?.name || channelId,
    slackUrl: `https://slack.com/archives/${channelId}`,
    incidentId,
    messageCount: history.messages?.length || 0,
  };
}

async function main() {
  if (!isJiraConfigured()) {
    throw new Error("Jira is not configured — set CLAIMS_FRAUD_JIRA_* variables in .env");
  }

  const channelId =
    parseArg("channel") || config.incidentSlackChannel || "C0BBZ0ERKNU";
  const count = parseCount();
  const labels = (parseArg("labels") || config.jiraDefaultLabels || "mobile-outage,sev1")
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);

  const ctx = await loadChannelContext(channelId);
  const templates = DEFAULT_ISSUES.slice(0, count);

  console.log(
    `Creating ${templates.length} Jira issue(s) in ${config.jiraProjectKey} from #${ctx.channelName}…`
  );

  const created = [];
  for (const template of templates) {
    const result = await createJiraIssue({
      summary: template.summary,
      description: template.description(ctx),
      labels,
    });
    created.push(result);
    console.log(`  ${result.key}  ${template.summary}`);
    console.log(`         ${result.url}`);
    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  console.log(`\nDone: ${created.map((issue) => issue.key).join(", ")}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
