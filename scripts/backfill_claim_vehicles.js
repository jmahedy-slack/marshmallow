/**
 * Backfill make/model/colour/registration on local claims and Salesforce Internal_Notes__c.
 * Usage: node scripts/backfill_claim_vehicles.js [--dry-run] [--claim=CLM-0025]
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const config = require("../src/config");
const { sfJson, escapeCliValue } = require("../src/salesforce/client");
const {
  buildInsuredVehicleNote,
  enrichClaimVehicle,
  parseInsuredVehicleFromNotes,
  vehicleFromUkCatalog,
  parseLegacyVehicleString,
} = require("../src/engine/vehicleFields");

const CLAIMS_PATH = path.join(__dirname, "..", "data", "claims.json");

function claimIndexFromId(id) {
  const match = String(id).match(/CLM-(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function ensureVehicleFields(claim, index) {
  const enriched = enrichClaimVehicle(claim);
  if (enriched.vehicleMake && enriched.vehicleModel && enriched.vehicleColour && enriched.vehicleRegistration) {
    return enriched;
  }
  const uk = vehicleFromUkCatalog(index, 2018 + (index % 6));
  const legacy = parseLegacyVehicleString(claim.vehicle);
  return {
    ...enriched,
    vehicleMake: enriched.vehicleMake || uk.make || legacy?.make,
    vehicleModel: enriched.vehicleModel || uk.model || legacy?.model,
    vehicleColour: enriched.vehicleColour || uk.colour,
    vehicleYear: enriched.vehicleYear || uk.vehicleYear || legacy?.year,
    vehicleRegistration: enriched.vehicleRegistration || uk.vehicleRegistration || claim.vehicleRegistration,
    vehicle: enriched.vehicle || uk.vehicle || claim.vehicle,
  };
}

async function updateSalesforceVehicleNote(claim, dryRun) {
  if (!claim.salesforceId) return { skipped: true, reason: "no_salesforce_id" };

  const noteLine = buildInsuredVehicleNote({
    make: claim.vehicleMake,
    model: claim.vehicleModel,
    colour: claim.vehicleColour,
    registration: claim.vehicleRegistration,
  });

  const current = await sfJson([
    "data",
    "query",
    "--query",
    `SELECT Internal_Notes__c FROM ${config.salesforceClaimObject} WHERE Id = '${claim.salesforceId}' LIMIT 1`,
  ]);
  const existing = current.records?.[0]?.Internal_Notes__c || "";
  if (existing.includes(noteLine) || parseInsuredVehicleFromNotes(existing)) {
    return { skipped: true, reason: "already_present" };
  }

  const combined = existing ? `${existing}\n${noteLine}` : noteLine;
  if (dryRun) {
    return { dryRun: true, noteLine };
  }

  await sfJson([
    "data",
    "update",
    "record",
    "--sobject",
    config.salesforceClaimObject,
    "--record-id",
    claim.salesforceId,
    "--values",
    `Internal_Notes__c='${escapeCliValue(combined)}'`,
  ]);
  return { updated: true, noteLine };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const onlyClaim = process.argv.find((a) => a.startsWith("--claim="))?.split("=")[1]?.toUpperCase();

  const data = JSON.parse(fs.readFileSync(CLAIMS_PATH, "utf8"));
  let updated = 0;
  let sfUpdated = 0;

  for (let i = 0; i < data.claims.length; i++) {
    const claim = data.claims[i];
    if (onlyClaim && claim.id.toUpperCase() !== onlyClaim) continue;

    const index = claimIndexFromId(claim.id);
    const next = ensureVehicleFields(claim, index);
    data.claims[i] = next;
    updated++;

    if (config.salesforceEnabled && next.salesforceId) {
      try {
        const result = await updateSalesforceVehicleNote(next, dryRun);
        if (result.updated || result.dryRun) {
          sfUpdated++;
          console.log(`${next.id}: ${result.noteLine}`);
        }
      } catch (err) {
        console.warn(`${next.id}: Salesforce update failed — ${err.message}`);
      }
    }
  }

  if (!dryRun) {
    fs.writeFileSync(CLAIMS_PATH, JSON.stringify(data, null, 2) + "\n");
  }

  console.log(`Enriched ${updated} local claims; Salesforce notes ${dryRun ? "previewed" : "updated"}: ${sfUpdated}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
