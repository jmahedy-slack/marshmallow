/**
 * Generate 50 suspect claims, create Claim__c records in Salesforce, save batch JSON.
 * Usage: node scripts/seed_fraud_claims_batch.js [--count=50] [--start=0] [--skip-sf]
 */
const fs = require("fs");
const path = require("path");
const { generateFraudClaims } = require("./lib/generateFraudClaims");
const { buildInsuredVehicleNote } = require("../src/engine/vehicleFields");
const { sfJson, getInstanceUrl, recordUrl, escapeCliValue } = require("../src/salesforce/client");
const config = require("../src/config");

const BATCH_PATH = path.join(__dirname, "..", "data", "fraud_claims_batch.json");
const CLAIMS_PATH = path.join(__dirname, "..", "data", "claims.json");

function parseCount() {
  const arg = process.argv.find((a) => a.startsWith("--count="));
  return arg ? Number(arg.split("=")[1]) : 50;
}

function parseStart() {
  const arg = process.argv.find((a) => a.startsWith("--start="));
  return arg ? Number(arg.split("=")[1]) : 0;
}

function parseArg(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function parseOverrides() {
  const year = parseArg("year");
  return {
    customerName: parseArg("customer"),
    vehicleMake: parseArg("make"),
    vehicleModel: parseArg("model"),
    vehicleColour: parseArg("colour"),
    vehicleRegistration: parseArg("registration"),
    vehicleYear: year ? Number(year) : null,
  };
}

function applyClaimOverrides(claim, overrides) {
  const hasOverride = Object.values(overrides).some((v) => v != null && v !== "");
  if (!hasOverride) return claim;

  if (overrides.customerName) claim.customerName = overrides.customerName;
  if (overrides.vehicleYear) claim.vehicleYear = overrides.vehicleYear;
  if (overrides.vehicleMake) claim.vehicleMake = overrides.vehicleMake;
  if (overrides.vehicleModel) claim.vehicleModel = overrides.vehicleModel;
  if (overrides.vehicleColour) claim.vehicleColour = overrides.vehicleColour;
  if (overrides.vehicleRegistration) claim.vehicleRegistration = overrides.vehicleRegistration;

  const year = claim.vehicleYear || new Date().getFullYear();
  const make = claim.vehicleMake || "";
  const model = claim.vehicleModel || "";
  claim.vehicle = `${year} ${make} ${model}`.trim();
  claim.insuredVehicleLabel = [make, model].filter(Boolean).join(" ");
  return claim;
}

function buildInternalNotes(claim) {
  return [claim.fraudNotes, buildInsuredVehicleNote({
    make: claim.vehicleMake,
    model: claim.vehicleModel,
    colour: claim.vehicleColour,
    registration: claim.vehicleRegistration,
  })].filter(Boolean).join(" ");
}

async function findOrCreateAccount(customerName) {
  const first = customerName.split(" ")[0];
  const q = `SELECT Id, Name FROM Account WHERE Name = '${customerName.replace(/'/g, "''")}' LIMIT 1`;
  const found = await sfJson(["data", "query", "--query", q]);
  if (found.records?.[0]) return found.records[0].Id;

  const likeQ = `SELECT Id, Name FROM Account WHERE Name LIKE '%${first.replace(/'/g, "''")}%' LIMIT 1`;
  const likeFound = await sfJson(["data", "query", "--query", likeQ]);
  if (likeFound.records?.[0]) return likeFound.records[0].Id;

  const created = await sfJson([
    "data",
    "create",
    "record",
    "--sobject",
    "Account",
    "--values",
    `Name='${escapeCliValue(customerName)}'`,
  ]);
  return created.id;
}

async function findPolicyId() {
  const result = await sfJson([
    "data",
    "query",
    "--query",
    "SELECT Id FROM InsurancePolicy WHERE Name LIKE 'POL%' LIMIT 1",
  ]);
  return result.records?.[0]?.Id || null;
}

async function createClaimInSalesforce(claim, accountId, policyId, instanceUrl) {
  const lossDate = claim.dateOfLoss.slice(0, 10);
  const reportedDate = claim.dateReported.slice(0, 10);

  const values = [
    `Account__c='${accountId}'`,
    "Claim_Status__c=Investigating",
    `Claim_Type__c='${escapeCliValue(claim.claimType === "Theft" ? "Theft" : "Accident")}'`,
    `Claimant_Name__c='${escapeCliValue(claim.customerName)}'`,
    `Incident_Date__c=${lossDate}`,
    `Date_Reported__c=${reportedDate}`,
    `Estimated_Loss_Amount__c=${claim.claimValueGbp}`,
    `Incident_Address__c='${escapeCliValue(claim.locationOfIncident)}'`,
    `Incident_Description__c='${escapeCliValue(claim.description)}'`,
    `Internal_Notes__c='${escapeCliValue(
      [
        claim.fraudNotes,
        buildInsuredVehicleNote({
          make: claim.vehicleMake,
          model: claim.vehicleModel,
          colour: claim.vehicleColour,
          registration: claim.vehicleRegistration,
        }),
      ]
        .filter(Boolean)
        .join("\n")
    )}'`,
    `Fraud_Flag__c=${claim.fraudFlag ? "true" : "false"}`,
  ];

  if (policyId) values.push(`Policy__c='${policyId}'`);

  const created = await sfJson([
    "data",
    "create",
    "record",
    "--sobject",
    config.salesforceClaimObject,
    "--values",
    values.join(" "),
  ]);

  const details = await sfJson([
    "data",
    "query",
    "--query",
    `SELECT Id, Name FROM ${config.salesforceClaimObject} WHERE Id = '${created.id}' LIMIT 1`,
  ]);
  const record = details.records[0];

  return {
    salesforceId: record.Id,
    id: record.Name,
    salesforceUrl: recordUrl(instanceUrl, config.salesforceClaimObject, record.Id),
  };
}

function mergeIntoClaimsJson(batchClaims) {
  const existing = JSON.parse(fs.readFileSync(CLAIMS_PATH, "utf8"));
  const byId = new Map(existing.claims.map((c) => [c.id.toUpperCase(), c]));

  for (const claim of batchClaims) {
    byId.set(claim.id.toUpperCase(), claim);
  }

  fs.writeFileSync(
    CLAIMS_PATH,
    JSON.stringify({ claims: Array.from(byId.values()) }, null, 2) + "\n"
  );
}

async function main() {
  const count = parseCount();
  const startIndex = parseStart();
  const skipSf = process.argv.includes("--skip-sf");
  const overrides = parseOverrides();
  const generated = generateFraudClaims(count, startIndex).map((claim) =>
    applyClaimOverrides({ ...claim }, overrides)
  );
  const seeded = [];

  console.log(`Generating ${count} suspect claims…`);

  if (!skipSf && !config.salesforceEnabled) {
    throw new Error("Salesforce is disabled — set CLAIMS_FRAUD_SALESFORCE_ENABLED=true");
  }

  const instanceUrl = skipSf ? null : await getInstanceUrl();
  const policyId = skipSf ? null : await findPolicyId();

  for (let i = 0; i < generated.length; i++) {
    const claim = generated[i];
    process.stdout.write(`  [${i + 1}/${count}] ${claim.customerName}… `);

    if (skipSf) {
      claim.id = claim.batchRef;
      claim.internalNotes = buildInternalNotes(claim);
      seeded.push(claim);
      console.log(claim.id);
      continue;
    }

    try {
      const accountId = await findOrCreateAccount(claim.customerName);
      const sf = await createClaimInSalesforce(claim, accountId, policyId, instanceUrl);
      const saved = {
        ...claim,
        id: sf.id,
        salesforceId: sf.salesforceId,
        salesforceUrl: sf.salesforceUrl,
        accountId,
        source: "salesforce",
        internalNotes: buildInternalNotes(claim),
      };
      seeded.push(saved);
      console.log(`${sf.id} → ${sf.salesforceUrl}`);
    } catch (err) {
      console.log(`FAILED (${err.message})`);
    }
  }

  fs.writeFileSync(
    BATCH_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        org: config.salesforceOrg,
        count: seeded.length,
        claims: seeded,
      },
      null,
      2
    ) + "\n"
  );

  mergeIntoClaimsJson(seeded);

  console.log(`\nSaved ${seeded.length} claims to ${BATCH_PATH}`);
  console.log(`Merged into ${CLAIMS_PATH}`);
  console.log("Next: node scripts/post_claim_alerts.js");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
