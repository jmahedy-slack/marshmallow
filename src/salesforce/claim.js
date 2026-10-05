const config = require("../config");
const { listPatterns } = require("../engine/store");
const {
  HOLD_ACTION_RE,
  HOLD_SALESFORCE_STATUS,
  RELEASE_SALESFORCE_STATUS,
} = require("../blocks/claimHoldStatusCard");
const {
  parseInsuredVehicleFromNotes,
  enrichClaimVehicle,
} = require("../engine/vehicleFields");
const {
  sfJson,
  getInstanceUrl,
  recordUrl,
  accountUrl,
  escapeSoqlString,
  escapeCliValue,
  patchSObjectRecord,
} = require("./client");

const CLAIM_FIELDS = [
  "Id",
  "Name",
  "Account__c",
  "Policy__c",
  "Claim_Status__c",
  "Claim_Type__c",
  "Claimant_Name__c",
  "Contact_Email__c",
  "Contact_Phone__c",
  "Date_Reported__c",
  "Estimated_Loss_Amount__c",
  "Fraud_Flag__c",
  "Incident_Address__c",
  "Incident_Date__c",
  "Incident_Description__c",
  "Police_Report_Number__c",
  "Witness_Names__c",
  "Internal_Notes__c",
  "Supporting_Documents__c",
  "Assigned_Adjuster__c",
  "Investigation_Start_Date__c",
].join(", ");

function mapSfClaimToInternal(sf, instanceUrl) {
  const reported = sf.Date_Reported__c ? new Date(sf.Date_Reported__c) : null;
  const loss = sf.Incident_Date__c ? new Date(sf.Incident_Date__c) : null;
  let reportingDelayHours = null;
  if (reported && loss) {
    reportingDelayHours = Math.round((reported.getTime() - loss.getTime()) / 3600000);
  }

  const internalNotes = sf.Internal_Notes__c || "";
  const fraudInNotes = /\b(red flag|fraud|suspicious|escalate)\b/i.test(internalNotes);
  const vehicleFromNotes = parseInsuredVehicleFromNotes(internalNotes);

  return enrichClaimVehicle({
    id: sf.Name,
    salesforceId: sf.Id,
    accountId: sf.Account__c,
    policyId: sf.Policy__c,
    customerName: sf.Claimant_Name__c,
    dateOfLoss: loss ? loss.toISOString() : null,
    dateReported: reported ? reported.toISOString() : null,
    claimType: sf.Claim_Type__c,
    claimStatus: sf.Claim_Status__c,
    claimValueGbp: sf.Estimated_Loss_Amount__c,
    locationOfIncident: sf.Incident_Address__c,
    description: sf.Incident_Description__c,
    policeReportProvided: Boolean(sf.Police_Report_Number__c),
    policeReportNumber: sf.Police_Report_Number__c,
    witnessCount: sf.Witness_Names__c ? 1 : 0,
    witnessNames: sf.Witness_Names__c,
    reportingDelayHours,
    fraudFlagFromSalesforce: Boolean(sf.Fraud_Flag__c),
    fraudSignalsInNotes: fraudInNotes,
    internalNotes,
    contactEmail: sf.Contact_Email__c,
    contactPhone: sf.Contact_Phone__c,
    assignedAdjuster: sf.Assigned_Adjuster__c,
    salesforceUrl: instanceUrl ? recordUrl(instanceUrl, config.salesforceClaimObject, sf.Id) : null,
    accountUrl: instanceUrl && sf.Account__c ? accountUrl(instanceUrl, sf.Account__c) : null,
    vehicleMake: vehicleFromNotes?.make || null,
    vehicleModel: vehicleFromNotes?.model || null,
    vehicleColour: vehicleFromNotes?.colour || null,
    vehicleRegistration: vehicleFromNotes?.registration || null,
    source: "salesforce",
  });
}

function mergeClaimRecords(local, sfMapped) {
  if (!local && !sfMapped) return null;
  if (!local) return sfMapped;
  if (!sfMapped) return { ...local, source: local.source || "local" };

  return enrichClaimVehicle({
    ...sfMapped,
    ...local,
    id: local.id || sfMapped.id,
    salesforceId: sfMapped.salesforceId,
    salesforceUrl: sfMapped.salesforceUrl,
    accountUrl: sfMapped.accountUrl,
    accountId: sfMapped.accountId || local.accountId,
    policyId: sfMapped.policyId || local.policyId,
    fraudFlagFromSalesforce: sfMapped.fraudFlagFromSalesforce,
    fraudSignalsInNotes: sfMapped.fraudSignalsInNotes,
    internalNotes: sfMapped.internalNotes || local.internalNotes,
    source: "merged",
  });
}

async function fetchClaimFromSalesforce(claimNumber) {
  if (!config.salesforceEnabled) {
    return {
      linked: false,
      object: config.salesforceClaimObject,
      note: "Salesforce integration disabled — set CLAIMS_FRAUD_SALESFORCE_ENABLED=true",
    };
  }

  const ref = String(claimNumber || "").trim().toUpperCase();
  if (!ref) {
    return { linked: false, error: "No claim reference provided" };
  }

  try {
    const query = `SELECT ${CLAIM_FIELDS} FROM ${config.salesforceClaimObject} WHERE Name = '${escapeSoqlString(ref)}' LIMIT 1`;
    const result = await sfJson(["data", "query", "--query", query]);

    if (!result.records?.length) {
      return {
        linked: false,
        object: config.salesforceClaimObject,
        org: config.salesforceOrg,
        claimNumber: ref,
        note: `No ${config.salesforceClaimObject} record with Name = ${ref}`,
      };
    }

    const instanceUrl = await getInstanceUrl();
    const record = mapSfClaimToInternal(result.records[0], instanceUrl);

    return {
      linked: true,
      object: config.salesforceClaimObject,
      org: config.salesforceOrg,
      orgId: config.salesforceOrgId,
      record,
      url: record.salesforceUrl,
    };
  } catch (err) {
    return {
      linked: false,
      object: config.salesforceClaimObject,
      org: config.salesforceOrg,
      error: err.message,
    };
  }
}

async function updateClaimProfilingResult({
  salesforceId,
  suspectScore,
  band,
  ruleIds,
  nextSteps,
}) {
  if (!config.salesforceEnabled || !salesforceId) {
    return { updated: false, reason: "Salesforce disabled or no record id" };
  }

  const fraudFlag = suspectScore >= 45;
  const noteLine =
    `[Claims Fraud Agent ${new Date().toISOString().slice(0, 10)}] Suspect ${suspectScore}/100 (${band}). Rules: ${(ruleIds || []).join(", ")}. Next: ${(nextSteps || [])[0] || "Review"}`;

  try {
    const current = await sfJson([
      "data",
      "query",
      "--query",
      `SELECT Internal_Notes__c FROM ${config.salesforceClaimObject} WHERE Id = '${salesforceId}' LIMIT 1`,
    ]);
    const existing = current.records?.[0]?.Internal_Notes__c || "";
    const combined = existing ? `${existing}\n${noteLine}` : noteLine;

    await patchSObjectRecord(config.salesforceClaimObject, salesforceId, {
      Fraud_Flag__c: fraudFlag,
      Internal_Notes__c: combined,
    });
    return { updated: true, fraudFlag, salesforceId };
  } catch (err) {
    return { updated: false, error: err.message };
  }
}

async function putClaimOnHold({ salesforceId, claimId, ruleId, initiatedBy }) {
  if (!config.salesforceEnabled || !salesforceId) {
    return { updated: false, error: "Salesforce disabled or claim not linked" };
  }

  const dateLabel = new Date().toISOString().slice(0, 10);
  const actor = initiatedBy ? ` by ${initiatedBy}` : "";
  const pattern = listPatterns().find((p) => p.id === ruleId);
  const holdDetail =
    pattern?.recommendedAction && HOLD_ACTION_RE.test(pattern.recommendedAction)
      ? pattern.recommendedAction
      : "Settlement blocked pending SIU review.";
  const noteLine =
    `[Claims Fraud Agent ${dateLabel}] Fraud hold applied from Slack (${ruleId || "profiler"})${actor}. ${holdDetail}`;

  try {
    const current = await sfJson([
      "data",
      "query",
      "--query",
      `SELECT Internal_Notes__c, Claim_Status__c FROM ${config.salesforceClaimObject} WHERE Id = '${salesforceId}' LIMIT 1`,
    ]);
    const row = current.records?.[0] || {};
    const existing = row.Internal_Notes__c || "";
    const combined = existing ? `${existing}\n${noteLine}` : noteLine;

    await patchSObjectRecord(config.salesforceClaimObject, salesforceId, {
      Claim_Status__c: HOLD_SALESFORCE_STATUS,
      Fraud_Flag__c: true,
      Internal_Notes__c: combined,
    });

    return {
      updated: true,
      claimId,
      salesforceId,
      status: HOLD_SALESFORCE_STATUS,
      displayStatus: "On hold",
    };
  } catch (err) {
    return { updated: false, error: err.message };
  }
}

async function releaseClaimFromHold({ salesforceId, claimId, ruleId, initiatedBy }) {
  if (!config.salesforceEnabled || !salesforceId) {
    return { updated: false, error: "Salesforce disabled or claim not linked" };
  }

  const dateLabel = new Date().toISOString().slice(0, 10);
  const actor = initiatedBy ? ` by ${initiatedBy}` : "";
  const noteLine =
    `[Claims Fraud Agent ${dateLabel}] Fraud hold released from Slack (${ruleId || "profiler"})${actor}. Settlement review resumed.`;

  try {
    const current = await sfJson([
      "data",
      "query",
      "--query",
      `SELECT Internal_Notes__c, Claim_Status__c FROM ${config.salesforceClaimObject} WHERE Id = '${salesforceId}' LIMIT 1`,
    ]);
    const row = current.records?.[0] || {};
    const existing = row.Internal_Notes__c || "";
    const combined = existing ? `${existing}\n${noteLine}` : noteLine;

    await patchSObjectRecord(config.salesforceClaimObject, salesforceId, {
      Claim_Status__c: RELEASE_SALESFORCE_STATUS,
      Fraud_Flag__c: false,
      Internal_Notes__c: combined,
    });

    return {
      updated: true,
      claimId,
      salesforceId,
      status: RELEASE_SALESFORCE_STATUS,
      displayStatus: RELEASE_SALESFORCE_STATUS,
    };
  } catch (err) {
    return { updated: false, error: err.message };
  }
}

async function linkSlackChannelToClaim({ salesforceId, channelName, channelId, teamId }) {
  if (!config.salesforceEnabled || !salesforceId || !channelId) {
    return { updated: false, reason: "Salesforce disabled or missing ids" };
  }

  const { buildSlackChannelNote } = require("../claimChannel/salesforceChannel");
  const noteLine = buildSlackChannelNote({ channelName, channelId, teamId });

  try {
    const current = await sfJson([
      "data",
      "query",
      "--query",
      `SELECT Internal_Notes__c FROM ${config.salesforceClaimObject} WHERE Id = '${salesforceId}' LIMIT 1`,
    ]);
    const existing = current.records?.[0]?.Internal_Notes__c || "";
    if (existing.includes(noteLine) || existing.includes(`(${channelId})`)) {
      return { updated: true, salesforceId, channelId, alreadyLinked: true };
    }
    const combined = existing ? `${existing}\n${noteLine}` : noteLine;

    await patchSObjectRecord(config.salesforceClaimObject, salesforceId, {
      Internal_Notes__c: combined,
    });
    return { updated: true, salesforceId, channelId, noteLine };
  } catch (err) {
    return { updated: false, error: err.message };
  }
}

async function createInvestigationCase({
  claimNumber,
  salesforceId,
  accountId,
  suspectScore,
  band,
  summary,
}) {
  if (!config.salesforceEnabled) {
    return {
      created: false,
      note: "Salesforce disabled",
      payload: { claimNumber, suspectScore, band },
    };
  }

  const subject = `Claims fraud review · ${claimNumber} · ${band} (${suspectScore}/100)`.slice(0, 255);
  const description = escapeCliValue(
    `Opened from Marshmallow Claims Fraud Agent.\nClaim: ${claimNumber}\nSuspect score: ${suspectScore}/100 (${band})\n\n${summary || ""}`
  );

  const values = [
    `Subject='${escapeCliValue(subject)}'`,
    `Description='${description}'`,
    "Origin='Slack'",
    "Priority='High'",
    "Status='New'",
  ];

  if (accountId) values.push(`AccountId='${accountId}'`);

  try {
    const created = await sfJson([
      "data",
      "create",
      "record",
      "--sobject",
      "Case",
      "--values",
      values.join(" "),
    ]);

    const instanceUrl = await getInstanceUrl();
    const details = await sfJson([
      "data",
      "query",
      "--query",
      `SELECT Id, CaseNumber, Subject FROM Case WHERE Id = '${created.id}' LIMIT 1`,
    ]);
    const record = details.records?.[0] || {};

    return {
      created: true,
      id: created.id,
      caseNumber: record.CaseNumber,
      subject: record.Subject || subject,
      url: recordUrl(instanceUrl, "Case", created.id),
      linkedClaimId: salesforceId,
    };
  } catch (err) {
    return { created: false, error: err.message };
  }
}

const { parseSlackChannelFromNotes } = require("../claimChannel/salesforceChannel");
const { listClaims } = require("../engine/store");

function findClaimIdByChannelIdLocal(channelId) {
  const needle = String(channelId || "").trim();
  if (!needle) return null;

  for (const claim of listClaims()) {
    const notes = claim.internalNotes || claim.fraudNotes || "";
    const linked = parseSlackChannelFromNotes(notes);
    if (linked?.channelId === needle) return claim.id;
    if (notes.includes(`(${needle})`)) return claim.id;
  }
  return null;
}

async function fetchClaimIdBySlackChannelId(channelId) {
  if (!channelId) {
    return { linked: false, reason: "no_channel" };
  }

  const needle = String(channelId).trim();
  const local = findClaimIdByChannelIdLocal(needle);
  if (local) {
    return { linked: true, claimId: String(local).toUpperCase(), channelId: needle, source: "local_claims" };
  }

  if (!config.salesforceEnabled) {
    return { linked: false, channelId: needle, note: "No local claim notes reference this Slack channel" };
  }

  try {
    for (const claim of listClaims()) {
      if (!claim.salesforceId) continue;
      const query = `SELECT Name, Internal_Notes__c FROM ${config.salesforceClaimObject} WHERE Id = '${escapeSoqlString(claim.salesforceId)}' LIMIT 1`;
      const result = await sfJson(["data", "query", "--query", query]);
      const record = result.records?.[0];
      const notes = record?.Internal_Notes__c || "";
      if (notes.includes(`(${needle})`)) {
        return {
          linked: true,
          claimId: String(record.Name).toUpperCase(),
          channelId: needle,
          source: "salesforce_record_fetch",
        };
      }
    }
    return { linked: false, channelId: needle, note: "No Claim__c notes reference this Slack channel" };
  } catch (err) {
    return { linked: false, channelId: needle, error: err.message };
  }
}

module.exports = {
  fetchClaimFromSalesforce,
  fetchClaimIdBySlackChannelId,
  findClaimIdByChannelIdLocal,
  updateClaimProfilingResult,
  putClaimOnHold,
  releaseClaimFromHold,
  linkSlackChannelToClaim,
  createInvestigationCase,
  mapSfClaimToInternal,
  mergeClaimRecords,
};
