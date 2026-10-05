const {
  buildAnalysisMarkdown,
  titleForResult,
} = require("../blocks/formatResponse");
const { formatRuleHitsMarkdown } = require("../blocks/streamCards");
const { formatGbp } = require("../blocks/streamCards");
const { formatNextStepsMarkdown } = require("../engine/nextSteps");
const config = require("../config");

function slackArchiveLink(channelId, messageTs) {
  if (!channelId || !messageTs) return null;
  return `https://slack.com/archives/${channelId}/p${messageTs.replace(".", "")}`;
}

function buildClaimPinText(result) {
  return titleForResult(result);
}

function buildClaimPinBlocks(context) {
  const { result, claim } = context;
  const primary = result.analysis?.results?.[0];

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*${claim?.id || result.query?.claimId}*` +
          (primary ? ` · ${primary.score}/100 (${primary.band})` : "") +
          (claim?.customerName ? ` · ${claim.customerName}` : ""),
      },
    },
  ];
}

function buildTranscriptSection(transcript) {
  if (!transcript?.length) {
    return "_No conversation transcript was captured from the source thread._";
  }
  return transcript
    .map((entry) => `**${entry.user}** · ${entry.text.replace(/\n/g, " ")}`)
    .join("\n\n");
}

function buildClaimDetailsMarkdown(result, claim) {
  const primary = result.analysis?.results?.[0];
  const lines = [
    "## Claim details",
    "",
    `- **Reference:** \`${claim?.id || result.query?.claimId}\``,
    `- **Policyholder:** ${claim?.customerName || "—"}`,
    `- **Claim type:** ${claim?.claimType || "—"}`,
    `- **Status:** ${claim?.claimStatus || "—"}`,
    `- **Estimated loss:** ${formatGbp(claim?.claimValueGbp || 0)}`,
    `- **Date of loss:** ${claim?.dateOfLoss || "—"}`,
    `- **Date reported:** ${claim?.dateReported || "—"}`,
    `- **Location:** ${claim?.locationOfIncident || "—"}`,
    `- **Repair garage:** ${claim?.repairGarage || "—"}`,
  ];

  if (claim?.description) {
    lines.push("", "### Incident description", "", claim.description);
  }

  if (primary) {
    lines.push(
      "",
      "## Profiler outcome",
      "",
      `- **Suspect score:** ${primary.score}/100 (${primary.band})`,
      `- **Rules triggered:** ${primary.hits?.length || 0}`
    );
    if (primary.hits?.length) {
      lines.push("", formatRuleHitsMarkdown(primary.hits));
    }
  }

  if (result.nextSteps?.length) {
    lines.push("", "## Recommended next steps", "", formatNextStepsMarkdown(result.nextSteps));
  }

  return lines.join("\n");
}

function buildClaimCanvasMarkdown(context) {
  const {
    result,
    claim,
    sourceLink,
    createdByLabel,
    createdAt,
    transcript,
    channelName,
  } = context;

  const sections = [
    `# Claim investigation · ${claim?.id || result.query?.claimId}`,
    "",
    "## Overview",
    `- **Claim reference:** ${claim?.id || result.query?.claimId}`,
    `- **Channel:** #${channelName}`,
    `- **Opened by:** ${createdByLabel}`,
    `- **Created:** ${createdAt}`,
    `- **Salesforce org:** ${config.salesforceOrg}`,
  ];

  if (claim?.salesforceUrl) {
    sections.push(`- **Salesforce Claim__c:** [${claim.id}](${claim.salesforceUrl})`);
  }
  if (claim?.accountUrl) {
    sections.push(`- **Linked account:** [Account](${claim.accountUrl})`);
  }
  if (sourceLink) {
    sections.push(`- **Source thread:** ${sourceLink}`);
  }

  sections.push("", buildClaimDetailsMarkdown(result, claim));

  if (result.type === "analysis") {
    sections.push("", "## Structured analysis", "", buildAnalysisMarkdown(result));
  }

  if (context.channelContext?.messages?.length) {
    sections.push(
      "",
      "## Slack channel context",
      "",
      `*${context.channelContext.messageCount} messages · ${context.channelContext.fileCount} files*`,
      ""
    );
    for (const m of context.channelContext.messages.slice(0, 20)) {
      sections.push(`- **${m.user}:** ${m.text.slice(0, 300)}`);
    }
    if (context.channelContext.files?.length) {
      sections.push("", "### Files referenced");
      for (const f of context.channelContext.files) {
        sections.push(`- ${f.name}${f.mimetype ? ` (${f.mimetype})` : ""}`);
      }
    }
  }

  sections.push("", "## Agent conversation transcript", "", buildTranscriptSection(transcript));

  sections.push(
    "",
    "## Working notes",
    "",
    "- [ ] Verify Claim__c fields against profiler signals",
    "- [ ] Review channel files and photo metadata",
    "- [ ] Confirm SIU hold before settlement",
    "- [ ] Document investigation outcome on Claim__c"
  );

  return sections.join("\n").slice(0, 120000);
}

function buildClaimContextPostText(context) {
  const { result, claim, transcript, sourceLink } = context;
  const primary = result.analysis?.results?.[0];
  const lines = [
    ":clipboard: *Claim investigation channel opened by Marshmallow Claims Fraud Agent*",
    "",
    `*Claim:* \`${claim?.id}\` · *${claim?.customerName || "Unknown policyholder"}*`,
    `*Type:* ${claim?.claimType || "—"} · *Loss:* ${formatGbp(claim?.claimValueGbp || 0)}`,
  ];

  if (primary) {
    lines.push(`*Suspect score:* ${primary.score}/100 (${primary.band})`);
  }
  if (claim?.salesforceUrl) {
    lines.push(`*Salesforce:* <${claim.salesforceUrl}|Open Claim__c ${claim.id}>`);
  }
  if (claim?.description) {
    lines.push("", `*Description:* ${claim.description.slice(0, 500)}`);
  }
  if (primary?.hits?.length) {
    lines.push("", "*Triggered rules:*", formatRuleHitsMarkdown(primary.hits));
  }
  if (result.nextSteps?.length) {
    lines.push("", "*Next steps:*", formatNextStepsMarkdown(result.nextSteps));
  }

  lines.push("", "## Agent conversation", "", buildTranscriptSection(transcript));
  if (sourceLink) lines.push("", `<${sourceLink}|Original thread>`);

  return lines.join("\n").slice(0, 39000);
}

function buildCreateChannelSeed(result) {
  const primary = result.analysis?.results?.[0];
  return {
    claimId: result.query?.claimId || primary?.claim?.id,
    score: primary?.score,
    band: primary?.band,
  };
}

module.exports = {
  buildClaimPinBlocks,
  buildClaimPinText,
  buildClaimCanvasMarkdown,
  buildClaimContextPostText,
  buildCreateChannelSeed,
  slackArchiveLink,
};
