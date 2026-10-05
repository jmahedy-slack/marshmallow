#!/usr/bin/env node
/**
 * Push non-secret-safe vars from .env to Heroku (secrets from .env too — run locally only).
 * Usage: node scripts/heroku-sync-config.js [--app=APP_NAME]
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const envPath = path.join(ROOT, ".env");
const appArg = process.argv.find((a) => a.startsWith("--app="));
const appFlag = appArg ? ["--app", appArg.split("=")[1]] : [];

const SKIP = new Set([
  "CLAIMS_FRAUD_PORT",
  "CLAIMS_FRAUD_PUBLIC_BASE_URL",
  "PATH",
  "HOME",
]);

if (!fs.existsSync(envPath)) {
  console.error(".env not found");
  process.exit(1);
}

const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
const pairs = [];
for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq <= 0) continue;
  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  if (SKIP.has(key)) continue;
  pairs.push(`${key}=${value}`);
}

pairs.push("CLAIMS_FRAUD_VISION_PROVIDER=openai");
pairs.push("CLAIMS_FRAUD_OLLAMA_ENABLED=false");

try {
  const sfOut = execFileSync(
    "sf",
    ["org", "display", "--target-org", process.env.CLAIMS_FRAUD_SALESFORCE_ORG || "mh-ss27-demo", "--verbose", "--json"],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }
  );
  const sfJson = JSON.parse(sfOut.slice(sfOut.indexOf("{")));
  if (sfJson.result?.sfdxAuthUrl) {
    pairs.push(`SFDX_AUTH_URL=${sfJson.result.sfdxAuthUrl}`);
  }
} catch {
  console.warn("Could not read SFDX_AUTH_URL from local sf CLI — set SFDX_AUTH_URL on Heroku manually");
}

execFileSync("heroku", ["config:set", ...pairs, ...appFlag], {
  stdio: "inherit",
  cwd: ROOT,
  maxBuffer: 20 * 1024 * 1024,
});

console.log("Heroku config updated (OpenAI vision enforced, public URL uses HEROKU_APP_NAME).");
