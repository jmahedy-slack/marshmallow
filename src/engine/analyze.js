const config = require("../config");
const { parseUserQuery } = require("./parser");
const { filterClaims, listPatterns, getClaimById } = require("./store");
const { analyzeClaims } = require("./rules");
const { readChannelContext, summarizeChannelForDisplay } = require("./channelContext");
const { buildNextSteps } = require("./nextSteps");
const { findClaimChannelForRecord, claimIdToChannelName } = require("../claimChannel/resolve");
const {
  fetchClaimFromSalesforce,
  mergeClaimRecords,
  updateClaimProfilingResult,
} = require("../salesforce/claim");

async function resolveChannelContextForAnalysis(query, options = {}) {
  const { client, channelContext: sessionContext } = options;
  let claimChannelMeta = null;

  if (query.claimId && client) {
    const matched = await findClaimChannelForRecord(client, query.claimId);
    claimChannelMeta = {
      found: Boolean(matched),
      channelId: matched?.id || null,
      channelName: matched?.name || null,
      searchedName: claimIdToChannelName(query.claimId),
      source: matched?.source || null,
      salesforceLinked: matched?.source?.startsWith("salesforce") || false,
    };

    if (matched) {
      const live = await readChannelContext({ client, channelId: matched.id });
      if (live && !live.error) {
        return {
          channelContext: {
            ...live,
            matchedClaim: query.claimId,
            matchType: matched.source?.startsWith("salesforce")
              ? "salesforce_claim_channel"
              : "claim_channel",
          },
          claimChannelMeta,
        };
      }
    }
  }

  return {
    channelContext: sessionContext || null,
    claimChannelMeta:
      claimChannelMeta ||
      (query.claimId
        ? {
            found: false,
            searchedName: claimIdToChannelName(query.claimId),
          }
        : null),
  };
}

async function resolveClaimForAnalysis(claimId) {
  if (!claimId) return filterClaims({ hours: 168 });

  const local = getClaimById(claimId);
  const sf = await fetchClaimFromSalesforce(claimId);

  if (sf?.record) {
    const merged = mergeClaimRecords(local, sf.record);
    return merged ? [merged] : [];
  }
  return local ? [local] : [];
}

function buildAnalysisResult(query, claims, channelContext, claimChannelMeta) {
  let analysis = analyzeClaims(claims, channelContext);

  if (query.claimId) {
    const needle = query.claimId.toUpperCase();
    analysis = {
      ...analysis,
      results: analysis.results.filter((r) => r.claim.id.toUpperCase() === needle),
    };
    analysis.flagged = analysis.results.length;
  }

  if (query.wantsHighRisk || query.intent === "portfolio_scan") {
    analysis = {
      ...analysis,
      results: analysis.results.filter((r) => r.score >= 25),
    };
    analysis.flagged = analysis.results.length;
  }

  const primary = analysis.results[0];
  const nextSteps = buildNextSteps({
    analysis,
    claim: primary?.claim,
    hits: primary?.hits,
    score: primary?.score,
    band: primary?.band,
    channelContext,
  });

  const salesforceMeta = primary?.claim?.salesforceUrl
    ? {
        linked: true,
        url: primary.claim.salesforceUrl,
        accountUrl: primary.claim.accountUrl,
        object: config.salesforceClaimObject,
        org: config.salesforceOrg,
      }
    : primary?.claim?.source === "merged" || primary?.claim?.salesforceId
      ? { linked: true, object: config.salesforceClaimObject, org: config.salesforceOrg }
      : {
          linked: false,
          note: `Query ${config.salesforceClaimObject} on org ${config.salesforceOrg} when record exists`,
        };

  return {
    query,
    type: "analysis",
    analysis,
    channelContext,
    claimChannelMeta,
    channelSummary: summarizeChannelForDisplay(channelContext, claimChannelMeta),
    nextSteps,
    salesforce: salesforceMeta,
  };
}

async function runAnalysis(text, options = {}) {
  const query = parseUserQuery(text);

  const { channelContext, claimChannelMeta } = await resolveChannelContextForAnalysis(query, options);

  if (query.intent === "help") {
    return {
      query,
      type: "help",
      message:
        "Select a *claims channel* from the dropdown, then ask me to review a claim reference (e.g. `CLM-2026-004781` or `CLM-0010`). " +
        `I look up the *Salesforce channel* linked to each Claim__c (or channel named \`#clm-0012\`), read messages and files, load *${config.salesforceClaimObject}* on Salesforce (org ${config.salesforceOrg}), and run the Marshmallow claims profiler. ` +
        "If no Salesforce channel exists, use **Create Salesforce channel** to open a record-linked investigation channel.",
    };
  }

  if (query.intent === "list_rules") {
    return {
      query,
      type: "rules",
      patterns: listPatterns(),
    };
  }

  const claims = query.claimId
    ? await resolveClaimForAnalysis(query.claimId)
    : filterClaims({ hours: query.hours });

  if (query.claimId && !claims.length) {
    return {
      query,
      type: "not_found",
      message:
        `No claim found with reference \`${query.claimId}\` in local seed or Salesforce ${config.salesforceClaimObject} (org ${config.salesforceOrg}).`,
      channelContext,
    };
  }

  const result = buildAnalysisResult(query, claims, channelContext, claimChannelMeta);

  if (options.persistToSalesforce && result.analysis?.results?.[0]) {
    const row = result.analysis.results[0];
    result.salesforceUpdate = await updateClaimProfilingResult({
      salesforceId: row.claim.salesforceId,
      suspectScore: row.score,
      band: row.band,
      ruleIds: row.hits.map((h) => h.ruleId),
      nextSteps: result.nextSteps,
    });
  }

  return result;
}

async function* analyzeInStages(text, options = {}) {
  const query = parseUserQuery(text);

  yield {
    stage: "parse",
    status: "in_progress",
    detail: "Parsing claim reference and scope",
  };

  if (query.intent === "help") {
    const { channelContext } = await resolveChannelContextForAnalysis(query, options);
    yield {
      stage: "parse",
      status: "complete",
      output: "Help request",
      result: await runAnalysis(text, { ...options, channelContext }),
    };
    return;
  }

  if (query.intent === "list_rules") {
    yield { stage: "parse", status: "complete", output: "Rule catalogue request" };
    yield { stage: "load", status: "in_progress", detail: "Loading profiler rules" };
    const patterns = listPatterns();
    yield { stage: "load", status: "complete", output: `${patterns.length} rules loaded` };
    yield { stage: "channel", status: "complete", output: "Skipped" };
    yield { stage: "rules", status: "complete", output: "Skipped" };
    yield {
      stage: "report",
      status: "complete",
      output: `${patterns.length} active patterns`,
      result: { query, type: "rules", patterns },
    };
    return;
  }

  yield {
    stage: "parse",
    status: "complete",
    output: query.claimId ? `Claim \`${query.claimId}\`` : "Portfolio scan",
  };

  yield {
    stage: "channel",
    status: "in_progress",
    detail: query.claimId
      ? `Searching for claim channel #${claimIdToChannelName(query.claimId)}`
      : options.channelContext
        ? `Reading ${options.channelContext.label || options.channelContext.channelName}`
        : "No claim channel selected",
  };

  const { channelContext, claimChannelMeta } = await resolveChannelContextForAnalysis(query, options);

  if (channelContext) {
    yield {
      stage: "channel",
      status: "complete",
      output:
        channelContext.matchType === "claim_channel"
          ? `Matched #${channelContext.channelName} — ${channelContext.messageCount} messages, ${channelContext.fileCount} files`
          : `${channelContext.messageCount} messages, ${channelContext.fileCount} files`,
    };
  } else if (query.claimId && claimChannelMeta && !claimChannelMeta.found) {
    yield {
      stage: "channel",
      status: "complete",
      output: `No channel #${claimChannelMeta.searchedName} — offer to create`,
    };
  } else {
    yield { stage: "channel", status: "complete", output: "Proceeding without channel context" };
  }

  yield {
    stage: "load",
    status: "in_progress",
    detail: `Loading ${config.salesforceClaimObject} from Salesforce (${config.salesforceOrg})`,
  };

  const claims = query.claimId
    ? await resolveClaimForAnalysis(query.claimId)
    : filterClaims({ hours: query.hours });

  if (query.claimId && !claims.length) {
    yield {
      stage: "load",
      status: "error",
      output: `Claim \`${query.claimId}\` not found`,
      result: await runAnalysis(text, { ...options, channelContext, claimChannelMeta }),
    };
    return;
  }

  const sfSource = claims[0]?.source || claims[0]?.salesforceId ? "salesforce" : "local seed";
  yield {
    stage: "load",
    status: "complete",
    output: `${claims.length} record(s) — ${sfSource}`,
  };

  yield {
    stage: "rules",
    status: "in_progress",
    detail: "Running Marshmallow claims profiler against patterns and channel intel",
  };

  const result = await runAnalysis(text, {
    ...options,
    channelContext,
    claimChannelMeta,
    persistToSalesforce: options.persistToSalesforce,
  });
  const flagged = result.analysis?.flagged ?? 0;
  const scanned = result.analysis?.scanned ?? 0;

  yield {
    stage: "rules",
    status: "complete",
    output: `${flagged} suspect of ${scanned} reviewed`,
  };

  yield {
    stage: "report",
    status: "in_progress",
    detail: "Building suspect score, rule hits, and recommended next steps",
  };

  yield {
    stage: "report",
    status: "complete",
    output: flagged > 0 ? "Suspect profiling complete" : "No profiler hits in scope",
    result,
  };
}

module.exports = {
  runAnalysis,
  analyzeInStages,
  parseUserQuery,
  resolveClaimForAnalysis,
  resolveChannelContextForAnalysis,
};
