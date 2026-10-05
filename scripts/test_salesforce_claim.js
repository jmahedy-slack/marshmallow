/**
 * Smoke test: fetch Claim__c from Salesforce and run profiler.
 * Usage: node scripts/test_salesforce_claim.js [CLM-0010]
 */
const { fetchClaimFromSalesforce } = require("../src/salesforce/claim");
const { runAnalysis } = require("../src/engine/analyze");

const claimRef = process.argv[2] || "CLM-0010";

(async () => {
  console.log("Fetching from Salesforce…");
  const sf = await fetchClaimFromSalesforce(claimRef);
  console.log(JSON.stringify(sf, null, 2));

  console.log("\nRunning profiler…");
  const result = await runAnalysis(`review claim ${claimRef}`, { persistToSalesforce: false });
  const primary = result.analysis?.results?.[0];
  if (primary) {
    console.log(`Score: ${primary.score}/100 (${primary.band})`);
    console.log("Hits:", primary.hits.map((h) => h.ruleId).join(", "));
  }
  console.log("Next steps:", result.nextSteps?.slice(0, 3));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
