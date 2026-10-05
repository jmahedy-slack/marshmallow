const { analyzeClaims } = require("../engine/rules");
const config = require("../config");

const AGENT_NAME = "Marshmallow Claims Fraud Agent";

function agentPrompt(claimId) {
  return `Review claim ${claimId} for suspected fraud`;
}

function formatGbp(n) {
  return `£${Number(n || 0).toLocaleString("en-GB")}`;
}

function formatTimestamp(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
}

function buildAlertId(claim) {
  const suffix = String(claim.id || claim.batchRef || "000000")
    .replace(/^CLM-/i, "")
    .replace(/[^0-9]/g, "")
    .padStart(6, "0")
    .slice(-6);
  return `CLAIMS-ALERT-2026-${suffix}`;
}

function scoreClaim(claim) {
  const analysis = analyzeClaims([claim]);
  return (
    analysis.results[0] || {
      claim,
      hits: [],
      score: 0,
      band: "Low",
    }
  );
}

function severityEmoji(band) {
  if (band === "Critical") return ":rotating_light:";
  if (band === "High") return ":warning:";
  if (band === "Medium") return ":large_yellow_circle:";
  return ":large_green_circle:";
}

function formatRuleSummary(hits) {
  if (!hits?.length) return "_No profiler rules matched._";
  return hits.map((hit) => `\`${hit.ruleId}\` ${hit.name}`).join(" · ");
}

function claimJsonPayload(claim, assessment, alertId) {
  return {
    alert_id: alertId,
    claim_id: claim.id,
    batch_ref: claim.batchRef || null,
    customer_name: claim.customerName,
    claim_type: claim.claimType,
    claim_status: claim.claimStatus,
    claim_value_gbp: claim.claimValueGbp,
    date_of_loss: claim.dateOfLoss,
    date_reported: claim.dateReported,
    location: claim.locationOfIncident,
    repair_garage: claim.repairGarage,
    policy_number: claim.policyNumber,
    risk_score: assessment.score,
    severity: assessment.band,
    triggered_rules: assessment.hits.map((h) => ({
      id: h.ruleId,
      name: h.name,
      severity: h.severity,
      weight: h.weight,
    })),
    salesforce: {
      org: config.salesforceOrg,
      org_id: config.salesforceOrgId,
      object: config.salesforceClaimObject,
      record_id: claim.salesforceId || null,
      claim_name: claim.id,
      url: claim.salesforceUrl || null,
    },
    agent_prompt: agentPrompt(claim.id),
  };
}

function buildSuspectAlertMessage(claim, assessment, alertId) {
  const { score, band } = assessment;
  return (
    `${severityEmoji(band)} *${alertId}* · \`${claim.id}\` · *${claim.customerName}* · ` +
    `${formatGbp(claim.claimValueGbp)} · ${band} (${score}/100) · ${claim.claimType}`
  );
}

function buildSuspectAlertBlocks(claim, assessment, alertId) {
  const { score, band, hits } = assessment;
  const sfUrl = claim.salesforceUrl;
  const sfLine = sfUrl
    ? `<${sfUrl}|Open ${config.salesforceClaimObject} ${claim.id}>`
    : "_Salesforce URL not available_";

  return [
    {
      type: "header",
      text: { type: "plain_text", text: `Claims fraud alert · ${band}`, emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Alert ID*\n${alertId}` },
        { type: "mrkdwn", text: `*Claim reference*\n\`${claim.id}\`` },
        { type: "mrkdwn", text: `*Policyholder*\n${claim.customerName}` },
        { type: "mrkdwn", text: `*Claim type*\n${claim.claimType}` },
        { type: "mrkdwn", text: `*Estimated loss*\n${formatGbp(claim.claimValueGbp)}` },
        { type: "mrkdwn", text: `*Risk score*\n${score}/100 (${band})` },
        { type: "mrkdwn", text: `*Date of loss*\n${formatTimestamp(claim.dateOfLoss)}` },
        { type: "mrkdwn", text: `*Date reported*\n${formatTimestamp(claim.dateReported)}` },
      ],
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Location*\n${claim.locationOfIncident || "—"}` },
        { type: "mrkdwn", text: `*Repair garage*\n${claim.repairGarage || "—"}` },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Triggered rules*\n${formatRuleSummary(hits)}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:cloud: *Salesforce*\n${sfLine}\nOrg: \`${config.salesforceOrg}\` · Object: \`${config.salesforceClaimObject}\``,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `_Marshmallow claims profiler · Open the ${AGENT_NAME} and ask: \`${agentPrompt(claim.id)}\`_`,
        },
      ],
    },
  ];
}

function enrichClaimAlert(claim) {
  const assessment = scoreClaim(claim);
  const alertId = buildAlertId(claim);
  const payload = claimJsonPayload(claim, assessment, alertId);

  return {
    claim,
    alertId,
    assessment,
    payload,
    text: buildSuspectAlertMessage(claim, assessment, alertId),
    blocks: buildSuspectAlertBlocks(claim, assessment, alertId),
    agentPrompt: agentPrompt(claim.id),
  };
}

module.exports = {
  AGENT_NAME,
  agentPrompt,
  buildAlertId,
  buildSuspectAlertBlocks,
  buildSuspectAlertMessage,
  claimJsonPayload,
  enrichClaimAlert,
  scoreClaim,
};
