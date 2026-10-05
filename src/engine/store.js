const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "..", "data");

let cache = null;

function loadData() {
  if (cache) return cache;
  const accountsFile = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "accounts.json"), "utf8"));
  const patterns = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "fraud_patterns.json"), "utf8"));
  const claimsFile = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "claims.json"), "utf8"));
  const channelSeeds = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "channel_seeds.json"), "utf8"));
  cache = {
    accounts: accountsFile.accounts,
    garageStats: accountsFile.garageStats || {},
    patterns,
    claims: claimsFile.claims,
    claimChannels: channelSeeds.channels,
    channelSeeds: channelSeeds.seeds,
  };
  return cache;
}

function listPatterns() {
  return loadData().patterns;
}

function listClaimChannels() {
  return loadData().claimChannels;
}

function listClaims() {
  return loadData().claims;
}

function getClaimById(id) {
  const needle = String(id).toUpperCase();
  return loadData().claims.find((c) => c.id.toUpperCase() === needle) || null;
}

function getAccountById(id) {
  return loadData().accounts.find((a) => a.id === id) || null;
}

function filterClaims({ claimId, accountId, hours }) {
  let rows = loadData().claims;
  if (claimId) {
    const one = getClaimById(claimId);
    return one ? [one] : [];
  }
  if (accountId) {
    rows = rows.filter((c) => c.accountId === accountId);
  }
  if (hours) {
    const cutoff = Date.now() - hours * 3600000;
    rows = rows.filter((c) => new Date(c.dateReported).getTime() >= cutoff);
  }
  return rows;
}

module.exports = {
  loadData,
  listPatterns,
  listClaimChannels,
  listClaims,
  getClaimById,
  getAccountById,
  filterClaims,
};
