const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const reportSrc = path.join(DATA_DIR, "claim_reports", "CLM-2026-004781.json");
const claimsFile = path.join(DATA_DIR, "claims.json");

if (!fs.existsSync(claimsFile)) {
  console.error("claims.json missing — nothing to seed");
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(reportSrc, "utf8"));
const claims = JSON.parse(fs.readFileSync(claimsFile, "utf8"));
const idx = claims.claims.findIndex((c) => c.id === report.claimNumber);
const merged = { ...report, id: report.claimNumber };
delete merged.claimNumber;
delete merged.salesforceObject;
delete merged.salesforceRecordUrl;

if (idx >= 0) {
  claims.claims[idx] = { ...claims.claims[idx], ...merged };
} else {
  claims.claims.unshift(merged);
}

fs.writeFileSync(claimsFile, JSON.stringify(claims, null, 2));
console.log(`Seeded ${merged.id} from claim report (${claims.claims.length} claims total)`);
