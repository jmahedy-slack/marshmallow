/**
 * Seed CLM-2026-004781 (Michael Turner motor claim) into Salesforce Claim__c.
 */
const fs = require("fs");
const path = require("path");
const { sfJson } = require("../src/salesforce/client");
const config = require("../src/config");

const reportPath = path.join(__dirname, "..", "data", "claim_reports", "CLM-2026-004781.json");
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));

async function findOrCreateAccount() {
  const name = report.customerName || "Michael Turner";
  const q = `SELECT Id, Name FROM Account WHERE Name LIKE '%${name.split(" ")[0]}%' LIMIT 1`;
  const found = await sfJson(["data", "query", "--query", q]);
  if (found.records?.[0]) return found.records[0].Id;

  const created = await sfJson([
    "data",
    "create",
    "record",
    "--sobject",
    "Account",
    "--values",
    `Name='${name.replace(/'/g, "''")}'`,
  ]);
  return created.id;
}

async function main() {
  const existing = await sfJson([
    "data",
    "query",
    "--query",
    `SELECT Id, Name FROM ${config.salesforceClaimObject} WHERE Name = '${report.claimNumber}' LIMIT 1`,
  ]);

  if (existing.records?.length) {
    console.log(`Claim already exists: ${existing.records[0].Name} (${existing.records[0].Id})`);
    return;
  }

  const accountId = await findOrCreateAccount();
  const policyQuery = await sfJson([
    "data",
    "query",
    "--query",
    `SELECT Id FROM InsurancePolicy WHERE Name LIKE 'POL%' LIMIT 1`,
  ]);
  const policyId = policyQuery.records?.[0]?.Id;

  const values = [
    `Account__c='${accountId}'`,
    "Claim_Status__c=Investigating",
    "Claim_Type__c=Accident",
    `Claimant_Name__c='${report.customerName.replace(/'/g, "''")}'`,
    "Incident_Date__c=2026-06-12",
    "Date_Reported__c=2026-06-14",
    `Estimated_Loss_Amount__c=${report.claimValueGbp}`,
    `Incident_Address__c='${report.locationOfIncident.replace(/'/g, "''")}'`,
    `Incident_Description__c='${report.description.replace(/'/g, "''").slice(0, 500)}'`,
    "Fraud_Flag__c=false",
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

  console.log(`Created Claim__c ${created.id} on ${config.salesforceOrg} — update Name manually to ${report.claimNumber} if auto-number differs`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
