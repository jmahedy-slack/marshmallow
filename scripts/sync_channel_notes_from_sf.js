/**
 * Copy Salesforce Internal_Notes__c (channel links, vehicle notes) into local claims.json.
 * Usage: node scripts/sync_channel_notes_from_sf.js [--dry-run] [--claim=CLM-0025]
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const config = require("../src/config");
const { sfJson } = require("../src/salesforce/client");

const CLAIMS_PATH = path.join(__dirname, "..", "data", "claims.json");

async function fetchNotesForClaim(claim) {
  if (!claim.salesforceId) return null;
  const result = await sfJson([
    "data",
    "query",
    "--query",
    `SELECT Name, Internal_Notes__c FROM ${config.salesforceClaimObject} WHERE Id = '${claim.salesforceId}' LIMIT 1`,
  ]);
  return result.records?.[0]?.Internal_Notes__c || null;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const claimFilter = process.argv.find((a) => a.startsWith("--claim="))?.split("=")[1];

  const data = JSON.parse(fs.readFileSync(CLAIMS_PATH, "utf8"));
  let updated = 0;

  for (const claim of data.claims) {
    if (claimFilter && claim.id.toUpperCase() !== claimFilter.toUpperCase()) continue;
    if (!claim.salesforceId) continue;

    const notes = await fetchNotesForClaim(claim);
    if (!notes) continue;

    const prev = claim.internalNotes || "";
    if (prev === notes) continue;

    console.log(`${claim.id}: syncing internal notes (${notes.length} chars)`);
    if (!dryRun) claim.internalNotes = notes;
    updated += 1;
  }

  if (!dryRun && updated) {
    fs.writeFileSync(CLAIMS_PATH, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`Updated ${updated} claim(s) in ${CLAIMS_PATH}`);
  } else if (dryRun) {
    console.log(`Dry run — would update ${updated} claim(s)`);
  } else {
    console.log("No changes needed");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
