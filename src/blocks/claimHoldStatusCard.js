const HOLD_ACTION_RE = /fraud hold|hold settlement|verify vrm.*vehicle identity|vehicle identity.*dvla/i;
const HOLD_SALESFORCE_STATUS = "Investigating";
const RELEASE_SALESFORCE_STATUS = "Under Review";
const HOLD_DISPLAY_STATUS = "On hold";

function truncate(text, max) {
  const body = String(text || "").trim();
  if (body.length <= max) return body;
  return `${body.slice(0, max - 1)}…`;
}

function isFraudHoldAction(hit) {
  return HOLD_ACTION_RE.test(String(hit?.recommendedAction || ""));
}

function findFraudHoldHit(hits) {
  return (hits || []).find(isFraudHoldAction) || null;
}

function claimAlreadyOnHold(claim) {
  if (!claim) return false;
  return Boolean(claim.fraudFlagFromSalesforce || claim.fraudFlag) && claim.claimStatus === HOLD_SALESFORCE_STATUS;
}

function parseHoldActionSeed(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

function isHoldStatusBlock(block) {
  const id = block?.block_id || "";
  return id.startsWith("claim-hold-");
}

function buildClaimHoldStatusCard({
  hits,
  claimId,
  claim,
  messageTs,
  held = false,
  ruleId,
  ruleName,
  salesforceId,
}) {
  let primary = findFraudHoldHit(hits);
  if (!primary && ruleId) {
    primary = {
      ruleId,
      name: ruleName || ruleId,
      recommendedAction: "Fraud hold applied",
    };
  }
  if (!primary) return null;

  const suffix = String(messageTs || Date.now()).replace(".", "");
  const onHold = held || claimAlreadyOnHold(claim);
  const statusLabel = onHold ? HOLD_DISPLAY_STATUS : claim?.claimStatus || "Open";
  const sfId = salesforceId || claim?.salesforceId || null;

  const blocks = [
    {
      type: "section",
      block_id: `claim-hold-${suffix}`,
      text: {
        type: "mrkdwn",
        text: truncate(
          onHold
            ? `*${claimId} · ${HOLD_DISPLAY_STATUS}*\nSettlement blocked pending SIU review.`
            : `*${primary.ruleId} · ${primary.name}*\n${primary.recommendedAction || "Review claim status"}\n_Status: ${statusLabel}_`,
          3000
        ),
      },
    },
  ];

  if (onHold) {
    blocks.push({
      type: "actions",
      block_id: `claim-hold-actions-${suffix}`,
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Release Claim" },
          action_id: `claims_release_from_hold_${suffix}`,
          value: JSON.stringify({
            claimId,
            ruleId: primary.ruleId,
            salesforceId: sfId,
          }),
        },
      ],
    });
  } else {
    blocks.push({
      type: "actions",
      block_id: `claim-hold-actions-${suffix}`,
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Put Claim on Hold" },
          style: "primary",
          action_id: `claims_put_on_hold_${suffix}`,
          value: JSON.stringify({
            claimId,
            ruleId: primary.ruleId,
            salesforceId: sfId,
          }),
        },
      ],
    });
  }

  return {
    text: onHold ? `Claim ${claimId} on hold` : `${primary.ruleId} · ${primary.name}`,
    blocks,
  };
}

function replaceHoldCardInBlocks(blocks, options) {
  const next = (blocks || []).filter((block) => !isHoldStatusBlock(block));
  const cardPart = buildClaimHoldStatusCard(options);
  if (!cardPart) return next;
  return [...cardPart.blocks, ...next.filter((block) => block?.type !== "header")];
}

module.exports = {
  HOLD_ACTION_RE,
  HOLD_SALESFORCE_STATUS,
  RELEASE_SALESFORCE_STATUS,
  HOLD_DISPLAY_STATUS,
  isFraudHoldAction,
  findFraudHoldHit,
  claimAlreadyOnHold,
  parseHoldActionSeed,
  isHoldStatusBlock,
  buildClaimHoldStatusCard,
  replaceHoldCardInBlocks,
};
