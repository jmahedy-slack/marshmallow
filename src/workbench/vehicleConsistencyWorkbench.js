const { getClaimById } = require("../engine/store");
const { fetchClaimFromSalesforce, mergeClaimRecords } = require("../salesforce/claim");
const { compareInsuredVsDetected } = require("../vision/vehicleConsistency");

/** Demo scenarios for Slack feature-channel walkthroughs (no live vision call required). */
const DEMO_SCENARIOS = [
  {
    id: "mismatch-high",
    title: "Insured saloon vs photo SUV (registration mismatch)",
    claimId: "CLM-0121",
    claim: {
      id: "CLM-0121",
      vehicleMake: "Mercedes-Benz",
      vehicleModel: "A-Class",
      vehicleColour: "black",
      vehicleRegistration: "KT19 OSW",
    },
    visionAnalysis: {
      vehicle: {
        make: "Mercedes-Benz",
        model: "GLE Coupe",
        colour: "blue",
        bodyStyle: "suv",
      },
      registrationPlate: { text: "OE17 AXW", confidence: "high" },
      damageSummary: "Front nearside impact; bumper and wing damage visible.",
    },
  },
  {
    id: "match-clean",
    title: "Policy and photo aligned (control case)",
    claimId: "CLM-2026-004781",
    claim: {
      id: "CLM-2026-004781",
      vehicleMake: "BMW",
      vehicleModel: "320d",
      vehicleColour: "grey",
      vehicleRegistration: "LD21 FGH",
    },
    visionAnalysis: {
      vehicle: {
        make: "BMW",
        model: "3 Series",
        colour: "grey",
        bodyStyle: "saloon",
      },
      registrationPlate: { text: "LD21 FGH", confidence: "high" },
      damageSummary: "Rear bumper scuff consistent with low-speed shunt.",
    },
  },
];

const FEATURE = {
  id: "vehicle-consistency-workbench",
  name: "Vehicle Consistency Workbench",
  version: "1.0.0",
  description:
    "Compare insured vehicle on Claim__c with OpenAI vision output from damage photos. Powers Slack fraud signals, canvas notes, and SIU escalation hints.",
  endpoints: [
    "GET /v1/features/vehicle-consistency-workbench",
    "GET /v1/workbench/demo-scenarios",
    "POST /v1/workbench/vehicle-consistency",
  ],
  slackDemoFlow: [
    "Post a damage photo in a #clm-* channel",
    "Agent runs vision, then policy vs detected comparison",
    "Thread shows mismatch flags; adjuster can apply fraud hold",
  ],
  relatedIncident: "INC-2026-0616-001",
};

async function resolveClaimRecord(claimId) {
  if (!claimId) return null;
  const local = getClaimById(claimId);
  const sf = await fetchClaimFromSalesforce(claimId);
  if (sf?.record) {
    return mergeClaimRecords(local, sf.record);
  }
  return local;
}

async function runVehicleConsistencyCheck({ claimId, claim, visionAnalysis, scenarioId }) {
  let resolvedClaim = claim;
  let resolvedAnalysis = visionAnalysis;

  if (scenarioId) {
    const scenario = DEMO_SCENARIOS.find((s) => s.id === scenarioId);
    if (!scenario) {
      const err = new Error(`Unknown scenarioId: ${scenarioId}`);
      err.status = 404;
      throw err;
    }
    resolvedClaim = scenario.claim;
    resolvedAnalysis = scenario.visionAnalysis;
  } else if (claimId && !resolvedClaim) {
    const records = await resolveClaimRecord(claimId);
    resolvedClaim = Array.isArray(records) ? records[0] : records;
  }

  if (!resolvedClaim || !resolvedAnalysis) {
    const err = new Error("Provide scenarioId, or claimId with visionAnalysis, or claim + visionAnalysis");
    err.status = 400;
    throw err;
  }

  const check = compareInsuredVsDetected(resolvedClaim, resolvedAnalysis);
  const criticalCount = check.flags.filter((f) => f.severity === "critical").length;
  const riskScore = Math.min(
    100,
    check.hits.reduce((sum, hit) => sum + (hit.weight || 10), 0) + criticalCount * 12
  );
  let band = "Low";
  if (riskScore >= 70) band = "Critical";
  else if (riskScore >= 45) band = "High";
  else if (riskScore >= 25) band = "Medium";

  return {
    claimId: resolvedClaim.id || claimId || null,
    scenarioId: scenarioId || null,
    consistent: check.consistent,
    riskScore,
    band,
    flags: check.flags,
    ruleHits: check.hits,
    insured: check.insured,
    detected: check.detected,
    summary: check.consistent
      ? "Policy vehicle consistent with vision detection"
      : `${check.flags.length} policy vs photo mismatch(es) detected`,
  };
}

module.exports = {
  FEATURE,
  DEMO_SCENARIOS,
  runVehicleConsistencyCheck,
};
