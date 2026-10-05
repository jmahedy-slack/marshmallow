const config = require("../config");
const ollama = require("./ollamaDamage");
const openai = require("./openaiDamage");

function useOpenAiVision() {
  return config.visionProvider === "openai" && Boolean(config.openaiApiKey);
}

function visionEnabled() {
  if (useOpenAiVision()) return true;
  return config.ollamaEnabled;
}

async function analyzeVehicleDamage(imageBuffer, options = {}) {
  if (useOpenAiVision()) {
    return openai.analyzeVehicleDamage(imageBuffer, options);
  }
  return ollama.analyzeVehicleDamage(imageBuffer, options);
}

async function visionAvailable() {
  if (useOpenAiVision()) {
    return openai.openaiAvailable();
  }
  if (!config.ollamaEnabled) return false;
  return ollama.ollamaAvailable();
}

function visionProviderLabel() {
  if (useOpenAiVision()) {
    return `OpenAI ${config.openaiVisionModel}`;
  }
  return `Ollama ${config.ollamaVisionModel} at ${config.ollamaBaseUrl}`;
}

module.exports = {
  analyzeVehicleDamage,
  visionAvailable,
  visionEnabled,
  visionProviderLabel,
  useOpenAiVision,
};
