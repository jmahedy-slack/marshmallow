const { sourceLabel } = require("../engine/ruleSources");

function formatGbp(n) {
  return `£${Number(n).toLocaleString("en-GB")}`;
}

const PIPELINE_STEPS = [
  { id: "parse", title: "Parse claim reference" },
  { id: "channel", title: "Read claims channel" },
  { id: "load", title: "Load Claim from Salesforce" },
  { id: "rules", title: "Run claims profiler" },
  { id: "report", title: "Suspect score & next steps" },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function taskChunk(id, title, status, extra = {}) {
  return {
    type: "task_update",
    id,
    title,
    status,
    ...extra,
  };
}

function statusSection(title, body, emoji = ":information_source:") {
  return {
    type: "section",
    text: {
      type: "mrkdwn",
      text: `${emoji} *${title}*\n${body}`.slice(0, 3000),
    },
  };
}

function pipelineIntroChunks() {
  return [
    { type: "plan_update", title: "Claims fraud profiling pipeline" },
    ...PIPELINE_STEPS.map((step) => taskChunk(step.id, step.title, "pending")),
  ];
}

function stepStartChunks(step, detail) {
  return [
    taskChunk(step.id, step.title, "in_progress", detail ? { details: detail } : undefined),
  ];
}

function stepCompleteChunks(step, output) {
  return [taskChunk(step.id, step.title, "complete", output ? { output } : undefined)];
}

function bandEmoji(band) {
  const b = String(band || "").toLowerCase();
  if (b === "critical" || b === "high") return ":warning:";
  if (b === "medium") return ":large_orange_diamond:";
  return ":white_circle:";
}

function formatRuleHitsMarkdown(hits) {
  if (!hits?.length) return "_No profiler rules triggered._";
  return hits
    .map(
      (h) =>
        `• ${sourceLabel(h.source)} · \`${h.ruleId}\` *${h.name}* (${h.severity}, +${h.weight})\n  _${h.description}_`
    )
    .join("\n");
}

function summaryAlert(result) {
  if (result.type === "help" || result.type === "not_found") {
    return statusSection("Result", result.message, ":information_source:");
  }
  if (result.type === "rules") {
    return statusSection(
      "Claims profiler rules",
      `${result.patterns.length} active profiling rules`,
      ":shield:"
    );
  }

  const { query, analysis } = result;
  const primary = analysis?.results?.[0];
  const flagged = analysis?.flagged ?? 0;
  const scanned = analysis?.scanned ?? 0;
  const emoji = flagged > 0 ? ":warning:" : ":white_check_mark:";

  let body = flagged > 0
    ? `${flagged} suspect of ${scanned} reviewed`
    : `No profiler hits in ${scanned} claim(s)`;

  if (query.claimId) body += `\nClaim: \`${query.claimId}\``;
  if (primary) {
    body += `\n*Suspect score:* ${primary.score}/100 — **${primary.band}**`;
  }
  if (result.channelSummary) {
    body += `\n\n${result.channelSummary}`;
  }

  return statusSection("Profiling complete", body, emoji);
}

module.exports = {
  PIPELINE_STEPS,
  sleep,
  pipelineIntroChunks,
  stepStartChunks,
  stepCompleteChunks,
  summaryAlert,
  statusSection,
  taskChunk,
  formatGbp,
  formatRuleHitsMarkdown,
  bandEmoji,
};
