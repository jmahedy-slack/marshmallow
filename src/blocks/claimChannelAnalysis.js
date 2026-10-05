const { formatGbp, bandEmoji } = require("./streamCards");
const { sourceLabel } = require("../engine/ruleSources");

const SLACK_BLOCK_MAX = 50;
const MRKDWN_MAX = 3000;
const RULE_HIT_LIMIT = 5;
const NEXT_STEP_LIMIT = 5;
const RULES_CATALOGUE_LIMIT = 8;
const CHANNEL_SUMMARY_MAX = 500;

function truncate(text, max) {
  const body = String(text || "").trim();
  if (body.length <= max) return body;
  return `${body.slice(0, max - 1)}…`;
}

function headerBlock(text) {
  return {
    type: "header",
    text: { type: "plain_text", text: truncate(text, 150), emoji: true },
  };
}

function sectionMrkdwn(text) {
  const body = truncate(text, MRKDWN_MAX);
  if (!body) return null;
  return { type: "section", text: { type: "mrkdwn", text: body } };
}

function fieldsSection(pairs) {
  const fields = pairs
    .filter((pair) => pair.value != null && pair.value !== "")
    .map((pair) => ({
      type: "mrkdwn",
      text: `*${pair.label}*\n${pair.value}`,
    }));
  if (!fields.length) return null;
  return { type: "section", fields: fields.slice(0, 10) };
}

function contextBlock(lines) {
  const elements = (Array.isArray(lines) ? lines : [lines])
    .map((line) => String(line || "").trim())
    .filter(Boolean)
    .map((line) => ({ type: "mrkdwn", text: truncate(line, 300) }));
  if (!elements.length) return null;
  return { type: "context", elements };
}

function formatCompactRuleHit(hit) {
  return `• ${sourceLabel(hit.source)} · \`${hit.ruleId}\` *${hit.name}* (${hit.severity}, +${hit.weight})`;
}

function formatCompactRuleHitsMarkdown(hits, limit = RULE_HIT_LIMIT) {
  if (!hits?.length) return "_No profiler rules triggered._";
  const shown = hits.slice(0, limit);
  const lines = shown.map(formatCompactRuleHit);
  let text = `:shield: *Triggered rules (${hits.length})*\n${lines.join("\n")}`;
  const extra = hits.length - limit;
  if (extra > 0) {
    text += `\n_+${extra} more — see Salesforce profiler note_`;
  }
  return text;
}

function formatCompactNextStepsMarkdown(steps, limit = NEXT_STEP_LIMIT) {
  if (!steps?.length) return "";
  const shown = steps.slice(0, limit);
  const lines = shown.map((step, index) => `${index + 1}. ${truncate(step, 200)}`);
  let text = `:compass: *Next steps*\n${lines.join("\n")}`;
  const extra = steps.length - limit;
  if (extra > 0) {
    text += `\n_+${extra} more in Salesforce note_`;
  }
  return text;
}

function compactChannelSummary(summary) {
  return truncate(summary, CHANNEL_SUMMARY_MAX);
}

function buildSalesforceSection(result) {
  const sf = result.salesforce;
  const claim = result.analysis?.results?.[0]?.claim;
  if (!sf?.linked && !claim?.salesforceUrl) return null;

  const links = [];
  if (claim?.salesforceUrl) {
    links.push(`<${claim.salesforceUrl}|Claim__c ${claim.id}>`);
  }
  if (claim?.accountUrl) {
    links.push(`<${claim.accountUrl}|Account>`);
  }

  const meta = [];
  if (sf?.org) meta.push(`Org \`${sf.org}\``);
  if (result.salesforceUpdate?.updated) {
    meta.push(":white_check_mark: Fraud flag updated");
  }

  let text = `:cloud: *Salesforce*`;
  if (links.length) text += `\n${links.join(" · ")}`;
  if (meta.length) text += `\n${meta.join(" · ")}`;

  return sectionMrkdwn(text);
}

function buildAssistantAnalysisBlocks(result) {
  const { query, analysis } = result;
  const primary = analysis?.results?.[0];
  const claimId = query.claimId || primary?.claim?.id;
  const blocks = [];

  if (primary) {
    blocks.push(headerBlock(`${primary.band} · ${claimId} · ${primary.score}/100`));
  } else if (claimId) {
    blocks.push(headerBlock(`Claims profiling · ${claimId}`));
  } else {
    blocks.push(headerBlock("Claims profiling results"));
  }

  const metricFields = [];
  if (primary) {
    metricFields.push({ label: "Suspect score", value: `${primary.score}/100` });
    metricFields.push({ label: "Severity", value: `${bandEmoji(primary.band)} ${primary.band}` });
    metricFields.push({ label: "Rules hit", value: String(primary.hits?.length || 0) });
    if (primary.claim?.customerName) {
      metricFields.push({ label: "Policyholder", value: primary.claim.customerName });
    }
    if (primary.claim?.claimValueGbp) {
      metricFields.push({ label: "Est. loss", value: formatGbp(primary.claim.claimValueGbp) });
    }
  }
  metricFields.push({
    label: "Reviewed",
    value: `${analysis?.flagged ?? 0} suspect · ${analysis?.scanned ?? 0} scanned`,
  });

  const metrics = fieldsSection(metricFields);
  if (metrics) blocks.push(metrics);

  if (!primary) {
    blocks.push(sectionMrkdwn("_No profiling rules matched in scope._"));
    return blocks.filter(Boolean);
  }

  if (result.channelSummary) {
    blocks.push({ type: "divider" });
    blocks.push(
      sectionMrkdwn(
        `:speech_balloon: *Claims channel*\n${compactChannelSummary(result.channelSummary)}`
      )
    );
  }

  if (primary.hits?.length) {
    blocks.push({ type: "divider" });
    blocks.push(sectionMrkdwn(formatCompactRuleHitsMarkdown(primary.hits)));
  }

  if (result.nextSteps?.length) {
    blocks.push({ type: "divider" });
    blocks.push(sectionMrkdwn(formatCompactNextStepsMarkdown(result.nextSteps)));
  }

  const salesforce = buildSalesforceSection(result);
  if (salesforce) {
    blocks.push({ type: "divider" });
    blocks.push(salesforce);
  }

  return blocks.filter(Boolean);
}

function buildRulesCatalogueBlocks(patterns) {
  const blocks = [headerBlock(`Claims profiler rules · ${patterns.length} active`)];
  const top = patterns.slice(0, RULES_CATALOGUE_LIMIT);
  const lines = top.map(
    (pattern) =>
      `• \`${pattern.id}\` *${pattern.name}* (${pattern.severity}, +${pattern.weight})`
  );
  blocks.push(sectionMrkdwn(lines.join("\n")));
  if (patterns.length > RULES_CATALOGUE_LIMIT) {
    blocks.push(
      contextBlock([
        `+${patterns.length - RULES_CATALOGUE_LIMIT} more rules · ask to list all profiling rules`,
      ])
    );
  }
  return blocks.filter(Boolean);
}

function buildHelpBlocks(message, title = "Claims fraud agent") {
  return [headerBlock(title), sectionMrkdwn(message)].filter(Boolean);
}

/**
 * Merge multiple { text, blocks } payloads into one Slack message payload.
 * Inserts dividers between block groups; always returns a plain-text fallback.
 */
function mergeBlockMessages(parts) {
  const blocks = [];
  const texts = [];

  for (const part of parts) {
    if (!part) continue;
    if (part.text) texts.push(part.text);
    if (part.blocks?.length) {
      if (blocks.length) blocks.push({ type: "divider" });
      blocks.push(...part.blocks);
    }
  }

  return {
    text: texts.join(" · ") || "Claims channel analysis",
    blocks: blocks.length ? blocks.slice(0, SLACK_BLOCK_MAX) : undefined,
  };
}

const CHANNEL_SUMMARY_BLOCK_MAX = 12;

function buildCanvasLinkSection(canvasLink) {
  if (canvasLink) {
    return sectionMrkdwn(`:page_facing_up: *Full report* — <${canvasLink}|Open channel canvas>`);
  }
  return sectionMrkdwn(
    ":page_facing_up: *Full report* — open the *Canvas* tab at the top of this channel."
  );
}

/**
 * Merge compact summary payloads for the claim channel thread (not canvas).
 */
function buildChannelSummaryPayload({
  claimId,
  parts,
  carouselPart,
  canvasLink,
  title = "Image analysis",
  includeCanvasLink = true,
  minimal = false,
}) {
  const blocks = minimal ? [] : [headerBlock(`${title} · ${claimId}`)];
  const texts = [];

  for (const part of parts) {
    if (!part) continue;
    if (part.text) texts.push(part.text);
    if (part.blocks?.length) {
      if (!minimal && blocks.length > 0) blocks.push({ type: "divider" });
      blocks.push(...part.blocks);
    }
  }

  if (carouselPart?.blocks?.length) {
    if (blocks.length) blocks.push({ type: "divider" });
    blocks.push(...carouselPart.blocks);
    if (carouselPart.text) texts.push(carouselPart.text);
  }

  if (includeCanvasLink) {
    if (blocks.length) blocks.push({ type: "divider" });
    blocks.push(buildCanvasLinkSection(canvasLink));
  }

  const fallback =
    texts.length > 0
      ? includeCanvasLink
        ? `${texts.join(" · ")} · Full report on channel canvas`
        : texts.join(" · ")
      : includeCanvasLink
        ? `Analysis summary for ${claimId} · Full report on channel canvas`
        : `Analysis summary for ${claimId}`;

  return {
    text: truncate(fallback, 300),
    blocks: blocks.length ? blocks.slice(0, CHANNEL_SUMMARY_BLOCK_MAX) : undefined,
  };
}

/**
 * Assemble full markdown report sections for Slack Canvas.
 */
function buildCanvasReportMarkdown({ claimId, sections, analyzedAt, trigger }) {
  const stamp = analyzedAt || new Date().toISOString();
  const lines = [
    `_Generated ${stamp}_`,
    trigger ? `_Trigger:_ ${trigger}` : null,
    "",
  ].filter(Boolean);

  for (const section of sections) {
    if (!section) continue;
    const body = String(section.body || section).trim();
    if (!body) continue;
    if (section.title) {
      lines.push(`## ${section.title}`, "", body, "");
    } else {
      lines.push(body, "");
    }
  }

  if (!lines.length) {
    return `_No analysis content for ${claimId}._`;
  }

  return lines.join("\n").trim();
}

module.exports = {
  mergeBlockMessages,
  buildChannelSummaryPayload,
  buildCanvasReportMarkdown,
  buildCanvasLinkSection,
  SLACK_BLOCK_MAX,
  CHANNEL_SUMMARY_BLOCK_MAX,
  headerBlock,
  sectionMrkdwn,
  fieldsSection,
  contextBlock,
  formatCompactRuleHit,
  formatCompactRuleHitsMarkdown,
  formatCompactNextStepsMarkdown,
  buildAssistantAnalysisBlocks,
  buildRulesCatalogueBlocks,
  buildHelpBlocks,
  buildSalesforceSection,
};
