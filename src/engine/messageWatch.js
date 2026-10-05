const { listPatterns, getClaimById } = require("./store");
const { evaluateChannelRules, matchPattern } = require("./rules");
const { formatRuleHitLine, sourceLabel } = require("./ruleSources");
const { mergeClaimRecords, fetchClaimFromSalesforce } = require("../salesforce/claim");
const { enrichClaimVehicle } = require("./vehicleFields");

const MESSAGE_SIGNALS = [
  {
    ruleId: "FIN-001",
    test: /\b(bank|account|sort code|payee|settlement details|iban)\b/i,
    evidence: (text) => ({ signal: "settlement/bank language", snippet: text.slice(0, 160) }),
  },
  {
    ruleId: "TIM-002",
    test: /\b(exif|metadata|predates?|before.*(loss|incident|date of loss))\b/i,
    evidence: (text) => ({ signal: "photo metadata timing", snippet: text.slice(0, 160) }),
  },
  {
    ruleId: "CHN-002",
    test: /\b(siu|suspect|fraud|investigation|staged|fraud hold)\b/i,
    evidence: (text) => ({ signal: "fraud escalation language", snippet: text.slice(0, 160) }),
  },
  {
    ruleId: "DOC-001",
    test: /\b(no police|without police|didn't report|did not report|no crime reference)\b/i,
    evidence: (text) => ({ signal: "police report gap mentioned", snippet: text.slice(0, 160) }),
  },
  {
    ruleId: "DOC-002",
    test: /\b(cctv|dashcam|witness|camera footage|no witnesses?)\b/i,
    evidence: (text) => ({ signal: "corroboration / witness topic", snippet: text.slice(0, 160) }),
  },
  {
    ruleId: "EST-001",
    test: /\b(repair estimate|garage quote|estimate (received|back)|bodyshop)\b/i,
    evidence: (text) => ({ signal: "repair estimate discussion", snippet: text.slice(0, 160) }),
  },
  {
    ruleId: "GAR-001",
    test: /\b(garage|body shop|repairer|same garage)\b/i,
    evidence: (text) => ({ signal: "garage network mention", snippet: text.slice(0, 160) }),
  },
  {
    ruleId: "DEM-001",
    test: /\b(expedite[ds]?|urgent settlement|pay quickly|asap payment|fast[- ]track(?:ed|ing)?|rush(?:ed)? payment|pressure)\b/i,
    evidence: (text) => ({ signal: "settlement pressure", snippet: text.slice(0, 160) }),
  },
  {
    ruleId: "POL-001",
    test: /\b(ncb|no claims bonus|excess reduction|cover upgrade|policy change)\b/i,
    evidence: (text) => ({ signal: "recent policy change", snippet: text.slice(0, 160) }),
  },
];

function dedupeHits(hits) {
  const seen = new Set();
  return hits.filter((hit) => {
    if (seen.has(hit.ruleId)) return false;
    seen.add(hit.ruleId);
    return true;
  });
}

function evaluateMessageSignals(text, claim) {
  const patterns = listPatterns();
  const hits = [];
  const body = String(text || "").trim();
  if (!body) return hits;

  for (const signal of MESSAGE_SIGNALS) {
    if (signal.test.test(body)) {
      hits.push(matchPattern(signal.ruleId, patterns, signal.evidence(body)));
    }
  }

  if (claim) {
    if (/\b(no third party|single vehicle|one car only)\b/i.test(body) && claim.thirdPartyInvolved) {
      hits.push(
        matchPattern("CHN-001", patterns, {
          contradictions: ["message omits third party involvement on Claim__c"],
          snippet: body.slice(0, 160),
        })
      );
    }
    if (/\b(before date of loss|before reported loss|predated photos?)\b/i.test(body)) {
      hits.push(
        matchPattern("CHN-001", patterns, {
          contradictions: ["message references predated damage evidence"],
          snippet: body.slice(0, 160),
        })
      );
    }

    const channelContext = {
      messages: [{ text: body }],
      files: [],
      matchType: "salesforce_claim_channel",
    };
    hits.push(...evaluateChannelRules(claim, channelContext, patterns));
  }

  return dedupeHits(hits).sort((a, b) => b.weight - a.weight);
}

async function loadClaimForWatch(claimId) {
  const local = enrichClaimVehicle(getClaimById(claimId));
  try {
    const sf = await fetchClaimFromSalesforce(claimId);
    return enrichClaimVehicle(mergeClaimRecords(local, sf?.record) || local);
  } catch {
    return local;
  }
}

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
  const body = truncate(text, 3000);
  if (!body) return null;
  return { type: "section", text: { type: "mrkdwn", text: body } };
}

function buildWatchSummaryBlocks({ hits, claimId }) {
  if (!hits.length) return null;

  const primary = hits[0];
  const action = truncate(primary.recommendedAction || "Review against Claim__c", 120);

  return {
    text: `${primary.ruleId} · ${primary.name}`,
    blocks: [
      sectionMrkdwn(
        truncate(
          `${primary.severity === "high" || primary.severity === "critical" ? ":warning:" : ":information_source:"} *\`${primary.ruleId}\`* ${primary.name}\n${action}`,
          3000
        )
      ),
    ].filter(Boolean),
  };
}

function buildWatchCanvasMarkdown({ hits, claimId, messageText }) {
  if (!hits.length) return "";

  const lines = [
    "## Profiler watch",
    "",
    `Claim \`${claimId}\``,
  ];

  if (messageText) {
    lines.push("", "**Message excerpt**", "", `> ${truncate(messageText.replace(/\n/g, " "), 500)}`);
  }

  lines.push("", `**Triggered rules (${hits.length})**`, "");
  for (const hit of hits) {
    lines.push(
      `### ${hit.ruleId} · ${hit.name}`,
      "",
      `- **Source:** ${sourceLabel(hit.source)}`,
      `- **Severity:** ${hit.severity} (+${hit.weight})`,
      `- **Action:** ${hit.recommendedAction || "Review against Claim__c"}`,
    );
    if (hit.description) {
      lines.push(`- **Detail:** ${hit.description}`);
    }
    if (hit.evidence) {
      const evidence =
        typeof hit.evidence === "string" ? hit.evidence : JSON.stringify(hit.evidence, null, 2);
      lines.push("", "```", evidence.slice(0, 800), "```");
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

function buildWatchBlocks({ hits, claimId }) {
  if (!hits.length) return null;

  const primary = hits[0];
  const action = truncate(primary.recommendedAction || "Review against Claim__c", 280);
  const blocks = [
    headerBlock(`Profiler watch · ${primary.ruleId}`),
    sectionMrkdwn(`*${primary.name}* (${primary.severity})`),
    sectionMrkdwn(`*Action:* ${action}`),
  ].filter(Boolean);

  if (hits.length > 1) {
    const also = hits
      .slice(1, 3)
      .map((hit) => `• ${formatRuleHitLine(hit)}`)
      .join("\n");
    blocks.push({ type: "divider" });
    blocks.push(sectionMrkdwn(`*Also consider*\n${also}`));
  }

  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `Claim \`${claimId}\`` }],
  });

  return {
    text: `Profiler watch: ${primary.ruleId} ${primary.name} (${primary.severity})`,
    blocks,
  };
}

function buildWatchReply({ hits, claimId }) {
  const payload = buildWatchBlocks({ hits, claimId });
  return payload?.text || null;
}

module.exports = {
  evaluateMessageSignals,
  loadClaimForWatch,
  buildWatchReply,
  buildWatchBlocks,
  buildWatchSummaryBlocks,
  buildWatchCanvasMarkdown,
};
