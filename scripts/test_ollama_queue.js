#!/usr/bin/env node
/** Quick check that Ollama vision requests run serially, not in parallel. */
require("dotenv").config();
const fs = require("fs");
const { analyzeVehicleDamage } = require("../src/vision/ollamaDamage");
const { ollamaQueueStats } = require("../src/vision/ollamaQueue");
const { getClaimById } = require("../src/engine/store");

const image =
  process.argv[2] ||
  "/Users/jmahedy/.cursor/projects/Users-jmahedy-Documents-Marshmallow/assets/r-9508aa3d-87f3-44e3-96d0-6c3a193a934c.png";

(async () => {
  if (!fs.existsSync(image)) {
    console.error("Image not found:", image);
    process.exit(1);
  }
  const buffer = fs.readFileSync(image);
  const claim = getClaimById("CLM-0025");
  const started = Date.now();

  const jobs = [1, 2].map((n) =>
    analyzeVehicleDamage(buffer, { claim, caption: `parallel-test-${n}` }).then((r) => ({
      n,
      ok: r.ok,
      ms: Date.now() - started,
    }))
  );

  console.log("Starting 2 parallel analyzeVehicleDamage calls…");
  const results = await Promise.all(jobs);
  console.log("Results:", results);
  console.log("Queue stats:", ollamaQueueStats());
  console.log(`Total elapsed: ${Date.now() - started}ms (serial queue should be ~2x single run)`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
