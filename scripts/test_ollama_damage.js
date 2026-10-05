#!/usr/bin/env node
/**
 * Test local Ollama vehicle damage analysis.
 * Usage: node scripts/test_ollama_damage.js [path/to/image.png] [CLM-0018]
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { analyzeVehicleDamage, ollamaAvailable } = require("../src/vision/ollamaDamage");
const { formatDamageAnalysisReply } = require("../src/vision/formatDamageReply");
const {
  compareInsuredVsDetected,
  formatVehicleConsistencyReply,
} = require("../src/vision/vehicleConsistency");
const { getClaimById } = require("../src/engine/store");
const config = require("../src/config");

const imagePath =
  process.argv[2] ||
  "/Users/jmahedy/.cursor/projects/Users-jmahedy-Documents-Marshmallow/assets/image-a733bfa9-99fc-46d3-8f90-d5f3ce42d6e9.png";
const claimId = (process.argv[3] || "CLM-0018").toUpperCase();

(async () => {
  console.log(`Ollama: ${config.ollamaBaseUrl} · model ${config.ollamaVisionModel}`);
  const up = await ollamaAvailable();
  if (!up) {
    console.error("\nOllama is not running. Start it with:");
    console.error("  ollama serve");
    console.error(`  ollama pull ${config.ollamaVisionModel}`);
    process.exit(1);
  }

  if (!fs.existsSync(imagePath)) {
    console.error(`Image not found: ${imagePath}`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(imagePath);
  const claim = getClaimById(claimId);
  console.log(`Analysing ${path.basename(imagePath)} for ${claimId}…\n`);

  const result = await analyzeVehicleDamage(buffer, { claim });
  console.log(formatDamageAnalysisReply({ claimId, fileName: path.basename(imagePath), result }));
  if (result?.ok && claim) {
    const check = compareInsuredVsDetected(claim, result.analysis);
    console.log("\n" + formatVehicleConsistencyReply(check));
    if (check.hits?.length) {
      console.log("\n*VEH-001 rule hits:*");
      for (const hit of check.hits) {
        console.log(`• ${hit.ruleId} ${hit.name} (${hit.severity})`);
      }
    }
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
