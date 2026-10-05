const { loadData, listPatterns } = require("./store");

function riskBand(score) {
  if (score >= 70) return "Critical";
  if (score >= 45) return "High";
  if (score >= 25) return "Medium";
  return "Low";
}

function matchPattern(id, patterns, evidence) {
  const p = patterns.find((x) => x.id === id) || {
    id,
    name: id,
    weight: 10,
    severity: "medium",
    source: "claims_profiler",
    recommendedAction: "Review",
  };
  return {
    ruleId: p.id,
    name: p.name,
    source: p.source || "claims_profiler",
    severity: p.severity,
    weight: p.weight,
    description: p.description,
    recommendedAction: p.recommendedAction,
    evidence,
  };
}

function evaluateChannelRules(claim, channelContext, patterns) {
  const hits = [];
  if (!channelContext || !claim?.id) return hits;

  const claimRef = claim.id.toUpperCase();
  const relatedMessages = (channelContext.messages || []).filter((m) =>
    !claimRef || m.text.toUpperCase().includes(claimRef)
  );
  if (!relatedMessages.length && !(channelContext.files?.length && claimRef)) {
    // For claim-matched channels, evaluate all messages even without explicit ref
    if (channelContext.matchType !== "claim_channel" && channelContext.matchType !== "salesforce_claim_channel") return hits;
  }

  const messagesToScan =
    relatedMessages.length > 0
      ? relatedMessages
      : channelContext.matchType === "claim_channel" || channelContext.matchType === "salesforce_claim_channel"
        ? channelContext.messages || []
        : [];
  if (!messagesToScan.length && !channelContext.files?.length) return hits;

  const combined = messagesToScan.map((m) => m.text).join("\n").toLowerCase();

  const fraudKeywords = /\b(siu|suspect|fraud|exif|metadata|hold|investigation|staged)\b/i;
  if (fraudKeywords.test(combined)) {
    hits.push(
      matchPattern("CHN-002", patterns, {
        messageCount: messagesToScan.length,
        sample: messagesToScan[0]?.text?.slice(0, 120),
      })
    );
  }

  const contradictions = [];
  if (combined.includes("before date of loss") || combined.includes("before reported loss")) {
    if (!claim.photoMetadataPredatesLoss) contradictions.push("channel mentions predated photos");
  }
  if (combined.includes("no third party") && claim.thirdPartyInvolved) {
    contradictions.push("channel omits third party");
  }
  if (contradictions.length) {
    hits.push(
      matchPattern("CHN-001", patterns, {
        contradictions,
        messageCount: messagesToScan.length,
      })
    );
  }

  return hits;
}

function evaluateClaim(claim, patterns, garageStats) {
  const hits = [];

  if (claim.reportingDelayHours > 24) {
    hits.push(
      matchPattern("TIM-001", patterns, {
        reportingDelayHours: claim.reportingDelayHours,
        reason: claim.reportingDelayReason || "Not stated",
      })
    );
  }

  if (claim.photoMetadataPredatesLoss) {
    hits.push(
      matchPattern("TIM-002", patterns, {
        deltaDays: claim.photoMetadataDeltaDays || 1,
      })
    );
  }

  if (
    claim.policyUpgradeDaysBeforeLoss != null &&
    claim.policyUpgradeDaysBeforeLoss <= 30 &&
    (claim.protectedNcbAdded || claim.reducedExcessAdded)
  ) {
    hits.push(
      matchPattern("POL-001", patterns, {
        daysBeforeLoss: claim.policyUpgradeDaysBeforeLoss,
        protectedNcb: claim.protectedNcbAdded,
        reducedExcess: claim.reducedExcessAdded,
      })
    );
  }

  if (claim.thirdPartyInvolved && !claim.policeReportProvided) {
    hits.push(matchPattern("DOC-001", patterns, { claimType: claim.claimType }));
  }

  if (claim.witnessCount === 0 && claim.claimValueGbp >= 5000) {
    hits.push(
      matchPattern("DOC-002", patterns, {
        claimValueGbp: claim.claimValueGbp,
        witnessCount: claim.witnessCount,
      })
    );
  }

  if (claim.repairEstimateHoursAfterReport != null && claim.repairEstimateHoursAfterReport <= 4) {
    hits.push(
      matchPattern("EST-001", patterns, {
        hoursAfterReport: claim.repairEstimateHoursAfterReport,
        garage: claim.repairGarage,
      })
    );
  }

  const garageCount =
    claim.repairGarageClaimsLast60Days ||
    garageStats[claim.repairGarage]?.claimsLast60Days ||
    0;
  if (garageCount >= 5) {
    hits.push(
      matchPattern("GAR-001", patterns, {
        garage: claim.repairGarage,
        claimsLast60Days: garageCount,
      })
    );
  }

  if (
    claim.bankAccountUpdatedHoursBeforeClaim != null &&
    claim.bankAccountUpdatedHoursBeforeClaim <= 48
  ) {
    hits.push(
      matchPattern("FIN-001", patterns, {
        hoursBeforeClaim: claim.bankAccountUpdatedHoursBeforeClaim,
      })
    );
  }

  if (claim.deviceLinkedToInvestigations) {
    hits.push(
      matchPattern("DEV-001", patterns, {
        linkedPolicyApplications: claim.linkedInvestigationPolicyCount || 1,
      })
    );
  }

  if (claim.expeditedSettlementRequested && claim.customerServiceContacts24h >= 3) {
    hits.push(
      matchPattern("DEM-001", patterns, {
        contacts24h: claim.customerServiceContacts24h,
        expedited: claim.expeditedSettlementRequested,
      })
    );
  }

  if (claim.vehicleValueGbp > 0 && claim.claimValueGbp / claim.vehicleValueGbp >= 0.5) {
    hits.push(
      matchPattern("VAL-001", patterns, {
        claimValueGbp: claim.claimValueGbp,
        vehicleValueGbp: claim.vehicleValueGbp,
        ratio: (claim.claimValueGbp / claim.vehicleValueGbp).toFixed(2),
      })
    );
  }

  if (claim.previousQuoteAttempts >= 4) {
    hits.push(
      matchPattern("QUO-001", patterns, {
        quoteAttempts: claim.previousQuoteAttempts,
      })
    );
  }

  if (claim.fraudFlagFromSalesforce || claim.fraudSignalsInNotes) {
    hits.push(
      matchPattern("SF-001", patterns, {
        fraudFlag: claim.fraudFlagFromSalesforce,
        notesSignal: claim.fraudSignalsInNotes,
      })
    );
  }

  const score = hits.reduce((sum, h) => sum + h.weight, 0);
  return {
    claim,
    hits,
    score: Math.min(100, score),
    band: riskBand(Math.min(100, score)),
  };
}

function analyzeClaims(claims, channelContext) {
  const { garageStats } = loadData();
  const patterns = listPatterns();
  const results = claims
    .map((claim) => {
      const base = evaluateClaim(claim, patterns, garageStats);
      const channelHits = evaluateChannelRules(claim, channelContext, patterns);
      const allHits = [...base.hits, ...channelHits];
      const score = Math.min(100, allHits.reduce((sum, h) => sum + h.weight, 0));
      return {
        ...base,
        hits: allHits,
        score,
        band: riskBand(score),
        channelHits: channelHits.length,
      };
    })
    .filter((r) => r.hits.length > 0)
    .sort((a, b) => b.score - a.score);

  return {
    scanned: claims.length,
    flagged: results.length,
    results,
    patterns,
  };
}

module.exports = {
  analyzeClaims,
  evaluateClaim,
  evaluateChannelRules,
  riskBand,
  matchPattern,
};
