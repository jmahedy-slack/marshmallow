function sourceLabel(source) {
  const map = {
    claims_profiler: "Claims profiler",
    channel_intel: "Channel intel",
  };
  return map[source] || source || "Profiler";
}

function formatRuleHitLine(hit) {
  return `\`${hit.ruleId}\` ${hit.name} — ${hit.recommendedAction || "Review"}`;
}

module.exports = { sourceLabel, formatRuleHitLine };
