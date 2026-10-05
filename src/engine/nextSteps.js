function unique(items) {
  return [...new Set(items)];
}

function buildNextSteps(result) {
  const steps = [];
  const claim = result.claim || result.analysis?.results?.[0]?.claim;
  const hits = result.hits || result.analysis?.results?.[0]?.hits || [];
  const score = result.score ?? result.analysis?.results?.[0]?.score ?? 0;
  const band = result.band ?? result.analysis?.results?.[0]?.band ?? "Low";
  const channelContext = result.channelContext;

  if (!claim) {
    return [
      "Select a claims channel from the dropdown, then provide a claim reference (e.g. CLM-2026-004781).",
      "The agent will reconcile Slack channel context with the Insurance_Claim__c record.",
    ];
  }

  const hitIds = hits.map((h) => h.ruleId);

  if (score >= 45) {
    steps.push("Place a fraud hold on settlement — do not authorise payment until SIU sign-off.");
  }

  if (hitIds.includes("TIM-002")) {
    steps.push(
      "Request original image files with full EXIF/metadata chain; consider forensic imaging vendor review."
    );
    steps.push("Interview policyholder on when and how damage photographs were taken.");
  }

  if (hitIds.includes("VEH-001")) {
    steps.push("Hold settlement; verify VRM and vehicle identity against policy schedule and DVLA.");
  }

  if (hitIds.includes("FIN-001")) {
    steps.push("Verify settlement bank account via payee confirmation and match to policyholder identity.");
    steps.push("Check recent Account updates in Salesforce for the linked Account record.");
  }

  if (hitIds.includes("GAR-001") || hitIds.includes("EST-001")) {
    steps.push(
      `Commission independent engineer inspection — challenge estimate from ${claim.repairGarage}.`
    );
    steps.push("Run garage network analysis across last 90 days for linked claims.");
  }

  if (hitIds.includes("DEV-001")) {
    steps.push("Link device fingerprint to SIU identity graph and unrelated policy applications.");
  }

  if (hitIds.includes("POL-001")) {
    steps.push("Review underwriting notes for cover changes within 30 days pre-loss.");
  }

  if (hitIds.includes("DOC-001") || hitIds.includes("DOC-002")) {
    steps.push("Request police reference or statutory declaration; seek CCTV/dashcam from incident location.");
  }

  if (channelContext?.messageCount > 0) {
    steps.push("Export full Slack channel transcript and attach to Insurance_Claim__c in Salesforce.");
  }

  if (hitIds.includes("CHN-002") || hitIds.includes("CHN-001")) {
    steps.push("Reconcile channel discussion with FNOL narrative — document discrepancies in case notes.");
  }

  if (band === "Critical" || band === "High") {
    steps.push("Open SIU investigation case and assign dedicated fraud handler.");
    steps.push("Schedule policyholder interview within 5 business days.");
  } else if (band === "Medium") {
    steps.push("Enhanced due diligence — request supporting documentation before next indemnity decision.");
  } else {
    steps.push("Continue standard claims handling with monitoring for new signals.");
  }

  for (const hit of hits.slice(0, 5)) {
    if (hit.recommendedAction && !steps.some((s) => s.includes(hit.recommendedAction))) {
      steps.push(`${hit.ruleId}: ${hit.recommendedAction}`);
    }
  }

  return unique(steps).slice(0, 10);
}

function formatNextStepsMarkdown(steps) {
  if (!steps?.length) return "";
  return steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
}

module.exports = { buildNextSteps, formatNextStepsMarkdown };
