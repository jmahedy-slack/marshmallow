#!/usr/bin/env node
const {
  runVehicleConsistencyCheck,
  DEMO_SCENARIOS,
} = require("../src/workbench/vehicleConsistencyWorkbench");

async function main() {
  for (const scenario of DEMO_SCENARIOS) {
    const result = await runVehicleConsistencyCheck({ scenarioId: scenario.id });
    console.log(`\n=== ${scenario.id}: ${scenario.title} ===`);
    console.log(`consistent=${result.consistent} band=${result.band} score=${result.riskScore}`);
    console.log(`flags=${result.flags.length} summary=${result.summary}`);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
