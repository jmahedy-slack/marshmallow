const { listPatterns } = require("./store");

const CLAIM_ID = /\b(CLM-(?:\d{4}-\d{6}|\d{4}))\b/i;

function parseUserQuery(text) {
  const raw = String(text || "").trim();
  const lower = raw.toLowerCase();

  const claimMatch = raw.match(CLAIM_ID);
  const claimId = claimMatch ? claimMatch[1].toUpperCase() : null;

  const wantsRules = /\b(rules?|patterns?)\b/i.test(raw) && !/\b(runbook|procedure)\b/i.test(raw);
  const wantsHighRisk = /\b(high[\s-]?risk|critical|flagged|suspect|suspicious)\b/i.test(raw);
  const wantsPortfolio = /\b(all claims|portfolio|scan all)\b/i.test(raw);
  const hoursMatch = raw.match(/\b(?:last|past)\s+(\d+)\s*(?:h|hr|hrs|hour|hours)\b/i);
  const hours = hoursMatch ? Number(hoursMatch[1]) : 168;

  let intent = "help";
  if (claimId) intent = "single_claim";
  else if (wantsRules) intent = "list_rules";
  else if (wantsPortfolio || wantsHighRisk) intent = "portfolio_scan";

  return {
    raw,
    claimId,
    hours,
    wantsHighRisk,
    wantsRules,
    intent,
  };
}

module.exports = { parseUserQuery, CLAIM_ID };
