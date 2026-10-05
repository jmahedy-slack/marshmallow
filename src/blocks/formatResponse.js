const { formatGbp } = require("./streamCards");
const {
  buildAssistantAnalysisBlocks,
  buildRulesCatalogueBlocks,
  buildHelpBlocks,
  contextBlock,
  formatCompactRuleHitsMarkdown,
  formatCompactNextStepsMarkdown,
} = require("./claimChannelAnalysis");
const { formatNextStepsMarkdown } = require("../engine/nextSteps");

const DISCLAIMER =
  "_Marshmallow claims profiler (demo). Verify against Claim__c in Salesforce before settlement or SIU escalation._";

function buildCreateChannelSeed(result) {
  const primary = result.analysis?.results?.[0];
  return {
    claimId: result.query?.claimId || primary?.claim?.id,
    score: primary?.score,
    band: primary?.band,
  };
}

function createClaimChannelEligible(result) {
  return (
    result.type === "analysis" &&
    result.query?.claimId &&
    result.claimChannelMeta?.found === false
  );
}

function createClaimChannelActionBlock(result, suffix) {
  if (!createClaimChannelEligible(result)) return [];
  const seed = buildCreateChannelSeed(result);
  return [
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: `Create Salesforce channel` },
          style: "primary",
          action_id: `claims_create_channel_${suffix}`,
          value: JSON.stringify(seed),
        },
      ],
    },
  ];
}

function buildCreateChannelCtaBlocks(result) {
  if (!createClaimChannelEligible(result)) return [];
  const claimId = result.query.claimId;
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `:slack: *No Salesforce channel for \`${claimId}\`*\n` +
          `Tap **Create Salesforce channel** in suggested prompts, or type:\n` +
          `\`Create channel for ${claimId}\``,
      },
    },
  ];
}

function feedbackBlocks(actionIdSuffix) {
  return [
    {
      type: "context_actions",
      elements: [
        {
          type: "feedback_buttons",
          action_id: `claims_feedback_${actionIdSuffix}`,
          positive_button: {
            text: { type: "plain_text", text: "Helpful" },
            accessibility_label: "Mark analysis as helpful",
            value: "positive",
          },
          negative_button: {
            text: { type: "plain_text", text: "Not helpful" },
            accessibility_label: "Mark analysis as not helpful",
            value: "negative",
          },
        },
      ],
    },
  ];
}

function buildAnalysisMarkdown(result) {
  const { query, analysis } = result;
  const primary = analysis?.results?.[0];
  const lines = [];

  if (query.claimId) lines.push(`**Claim:** \`${query.claimId}\``);
  lines.push(`**Reviewed:** ${analysis.scanned} · **Suspect:** ${analysis.flagged}`);

  if (!primary) {
    lines.push("\nNo profiling rules matched in scope.");
    return lines.join("\n");
  }

  lines.push(`**Suspect score:** ${primary.score}/100 — **${primary.band}**`);
  if (primary.claim?.customerName) lines.push(`**Policyholder:** ${primary.claim.customerName}`);
  if (primary.claim?.claimValueGbp) {
    lines.push(`**Estimated loss:** ${formatGbp(primary.claim.claimValueGbp)}`);
  }

  if (primary.hits?.length) {
    lines.push("\n### Triggered profiling rules\n");
    lines.push(formatCompactRuleHitsMarkdown(primary.hits, 10));
  }

  if (result.nextSteps?.length) {
    lines.push("\n### Next steps\n");
    lines.push(formatCompactNextStepsMarkdown(result.nextSteps, 10));
  }

  return lines.join("\n");
}

function buildStreamingMarkdown(result) {
  if (result.type === "rules") {
    return `_${result.patterns.length} active profiling rules — compact catalogue below._`;
  }
  if (result.type !== "analysis") return result.message || "";
  const primary = result.analysis?.results?.[0];
  if (!primary) return "_Profiling complete — no rules matched._";
  const claimId = result.query?.claimId || primary.claim?.id;
  return `_${primary.band} · ${primary.score}/100 · \`${claimId}\` — details below._`;
}

function withoutTableBlocks(blocks) {
  return (blocks || []).filter((block) => block.type !== "table");
}

function buildStopBlocks(result, suffix, options = {}) {
  const blocks = [];

  if (result.type === "help" || result.type === "not_found") {
    blocks.push(...buildHelpBlocks(result.message, titleForResult(result)));
  } else if (result.type === "rules") {
    blocks.push(...buildRulesCatalogueBlocks(result.patterns));
  } else if (result.type === "analysis") {
    blocks.push(...buildAssistantAnalysisBlocks(result));
    if (!options.omitChannelAction) {
      blocks.push({ type: "divider" });
      blocks.push(...createClaimChannelActionBlock(result, suffix));
    }
  }

  const disclaimer = contextBlock([DISCLAIMER]);
  if (disclaimer) blocks.push(disclaimer);
  blocks.push(...feedbackBlocks(suffix));

  return blocks.filter(Boolean);
}

function stripCreateChannelBlocks(blocks) {
  return (blocks || []).filter(
    (block) =>
      !(
        block.type === "actions" &&
        block.elements?.some((el) => el.action_id?.startsWith("claims_create_channel_"))
      )
  );
}

function titleForResult(result) {
  if (result.type === "rules") return "Claims profiler rules";
  if (result.type === "not_found") return "Claim not found";
  if (result.type === "help") return "Claims fraud agent help";

  const primary = result.analysis?.results?.[0];
  if (primary) {
    return `${primary.band} · ${primary.claim.id} · ${primary.score}/100`;
  }
  if (result.query?.claimId) return `Review ${result.query.claimId}`;
  return "Claims profiling results";
}

module.exports = {
  buildStopBlocks,
  buildAnalysisMarkdown,
  buildStreamingMarkdown,
  titleForResult,
  withoutTableBlocks,
  stripCreateChannelBlocks,
  createClaimChannelEligible,
  createClaimChannelActionBlock,
  buildCreateChannelCtaBlocks,
  buildCreateChannelSeed,
  DISCLAIMER,
};
