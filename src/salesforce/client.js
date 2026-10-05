const fs = require("fs");
const { execFile } = require("child_process");
const { promisify } = require("util");
const config = require("../config");

const execFileAsync = promisify(execFile);

let cachedInstanceUrl = null;
let cachedOrgAuth = null;
let cachedSfCli = null;

function resolveSfCli() {
  if (cachedSfCli) return cachedSfCli;

  const candidates = [
    config.salesforceCliPath,
    process.env.SF_CLI_PATH,
    "/usr/local/bin/sf",
    "/opt/homebrew/bin/sf",
    "sf",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate === "sf" || fs.existsSync(candidate)) {
      cachedSfCli = candidate;
      return candidate;
    }
  }

  cachedSfCli = "sf";
  return cachedSfCli;
}

function escapeSoqlString(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function escapeCliValue(value) {
  return String(value || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "''")
    .slice(0, 32000);
}

async function sfJson(args) {
  const org = config.salesforceOrg;
  const sfCli = resolveSfCli();
  const env = {
    ...process.env,
    PATH: process.env.PATH || "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin",
  };

  const { stdout, stderr } = await execFileAsync(
    sfCli,
    [...args, "--target-org", org, "--json"],
    { maxBuffer: 10 * 1024 * 1024, env }
  );

  const payload = stdout.includes("{") ? stdout.slice(stdout.indexOf("{")) : stdout;
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch (err) {
    throw new Error(`SF CLI returned invalid JSON (${sfCli}): ${stderr || stdout || err.message}`);
  }

  if (parsed.status !== 0) {
    const detail =
      parsed.message ||
      parsed.result?.message ||
      parsed.stack ||
      parsed.name ||
      "SF CLI command failed";
    throw new Error(detail);
  }

  return parsed.result;
}

async function getInstanceUrl() {
  if (cachedInstanceUrl) return cachedInstanceUrl;
  const auth = await getOrgAuth();
  return auth.instanceUrl;
}

async function getOrgAuth() {
  if (cachedOrgAuth) return cachedOrgAuth;
  const result = await sfJson(["org", "display"]);
  cachedOrgAuth = {
    instanceUrl: result.instanceUrl,
    accessToken: result.accessToken,
  };
  cachedInstanceUrl = result.instanceUrl;
  return cachedOrgAuth;
}

async function downloadContentVersion(versionId, options = {}) {
  const maxBytes = options.maxBytes || 8 * 1024 * 1024;
  const id = String(versionId || "").trim();
  if (!id) throw new Error("ContentVersion id required");

  const { instanceUrl, accessToken } = await getOrgAuth();
  const url = `${instanceUrl}/services/data/v59.0/sobjects/ContentVersion/${id}/VersionData`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Salesforce file download failed: ${res.status}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > maxBytes) {
    throw new Error(`Salesforce file exceeds ${maxBytes} byte limit`);
  }
  return buffer;
}

function recordUrl(instanceUrl, objectApiName, recordId) {
  return `${instanceUrl}/lightning/r/${objectApiName}/${recordId}/view`;
}

function accountUrl(instanceUrl, accountId) {
  return `${instanceUrl}/lightning/r/Account/${accountId}/view`;
}

module.exports = {
  sfJson,
  getInstanceUrl,
  getOrgAuth,
  downloadContentVersion,
  recordUrl,
  accountUrl,
  escapeSoqlString,
  escapeCliValue,
  resolveSfCli,
};
