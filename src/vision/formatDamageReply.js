const MRKDWN_MAX = 3000;
const SUMMARY_MAX = 400;
const { visionProviderLabel, useOpenAiVision } = require("./damageAnalysis");

function demoDisclaimer() {
  if (useOpenAiVision()) {
    return `_OpenAI vision (${visionProviderLabel()}). Verify before SIU escalation._`;
  }
  return "_Local Ollama vision (demo). Verify before SIU escalation._";
}
const { normalizePlate } = require("../engine/vehicleFields");

function asText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function asBulletList(items, limit = 4) {
  if (!items) return [];
  const list = Array.isArray(items) ? items : [asText(items)];
  return list
    .map((item) => asText(item).trim())
    .filter(Boolean)
    .slice(0, limit);
}

function truncate(text, max) {
  const body = String(text || "").trim();
  if (body.length <= max) return body;
  return `${body.slice(0, max - 1)}…`;
}

function truncateMrkdwn(text) {
  return truncate(text, MRKDWN_MAX);
}

function headerBlock(text) {
  return {
    type: "header",
    text: { type: "plain_text", text: truncate(text, 150), emoji: true },
  };
}

function sectionMrkdwn(text) {
  const body = truncateMrkdwn(text);
  if (!body) return null;
  return { type: "section", text: { type: "mrkdwn", text: body } };
}

function contextElements(lines) {
  const elements = lines
    .map((line) => String(line || "").trim())
    .filter(Boolean)
    .map((line) => ({ type: "mrkdwn", text: truncate(line, 300) }));
  if (!elements.length) return null;
  return { type: "context", elements };
}

function fieldsSection(pairs) {
  const fields = pairs
    .filter((pair) => pair.value)
    .map((pair) => ({
      type: "mrkdwn",
      text: `*${pair.label}*\n${pair.value}`,
    }));
  if (!fields.length) return null;
  return { type: "section", fields: fields.slice(0, 10) };
}

function compactVehicleLabel(vehicle) {
  const modelText = asText(vehicle.model).trim();
  const modelLower = modelText.toLowerCase();
  const bodyStyle = asText(vehicle.bodyStyle).trim();
  const bodyLower = bodyStyle.toLowerCase();
  const genericBody = new Set(["suv", "saloon", "sedan", "coupe", "hatchback", "estate", "van", "unclear"]);
  const showBodyStyle =
    bodyStyle &&
    !bodyStyle.includes("|") &&
    !genericBody.has(bodyLower) &&
    !modelLower.includes(bodyLower);

  const parts = [
    vehicle.make,
    !isGenericModelWord(modelText) ? modelText : null,
    vehicle.generation,
    showBodyStyle ? bodyStyle : null,
    isGenericModelWord(modelText) && genericBody.has(bodyLower) ? bodyStyle : null,
  ]
    .map((part) => asText(part).trim())
    .filter((part) => part && part.toLowerCase() !== "unclear");
  if (!parts.length) return null;
  const colour = asText(vehicle.colour).trim();
  const conf = asText(vehicle.identificationConfidence).trim();
  let line = parts.join(" ");
  if (colour && colour.toLowerCase() !== "unclear") line += ` · ${colour}`;
  if (conf && conf.toLowerCase() !== "unclear") line += ` _(${conf})_`;
  return line;
}

function isGenericModelWord(value) {
  const m = String(value || "").trim().toLowerCase();
  return !m || ["suv", "saloon", "sedan", "coupe", "hatchback", "estate", "van", "unclear", "null"].includes(m);
}

function compactPlateLabel(plate) {
  const plateText = asText(plate.text).trim();
  const plateUnreadable =
    !plateText ||
    ["null", "not_readable", "unreadable", "n/a", "none"].includes(plateText.toLowerCase());
  if (!plateUnreadable) {
    const country = asText(plate.country).trim();
    const plateConf = asText(plate.confidence).trim();
    let line = `\`${plateText.toUpperCase()}\``;
    if (country && country !== "unclear") line += ` · ${country}`;
    if (plateConf && plateConf.toLowerCase() !== "unclear") line += ` _(${plateConf})_`;
    return line;
  }
  const plateNote = asText(plate.notes).trim();
  return plateNote ? `_not readable_ — ${truncate(plateNote, 80)}` : "_not readable_";
}

function formatRegistrationField(plate, claim) {
  const detectedLine = compactPlateLabel(plate || {});
  const policyReg = String(claim?.vehicleRegistration || "").trim();
  const detectedText = asText(plate?.text).trim();

  if (!policyReg) return detectedLine;

  if (
    !detectedText ||
    ["null", "not_readable", "unreadable", "n/a", "none"].includes(detectedText.toLowerCase())
  ) {
    return `${detectedLine}\n*Policy VRM:* \`${policyReg.toUpperCase()}\``;
  }

  const match = normalizePlate(detectedText) === normalizePlate(policyReg);
  if (match) {
    return `${detectedLine}\n:white_check_mark: Matches policy VRM`;
  }

  return `${detectedLine}\n:warning: Insured Vehicle Registration: \`${policyReg.toUpperCase()}\``;
}

function buildDamageAnalysisAckCard({ claimId }) {
  const safeId = String(claimId).replace(/[^a-zA-Z0-9-]/g, "-");
  return {
    text: `Analysing damage for ${claimId}…`,
    blocks: [
      {
        type: "section",
        block_id: `damage-analysis-${safeId}`,
        text: {
          type: "mrkdwn",
          text: `:hourglass_flowing_sand: *Damage analysis* · \`${truncate(claimId, 80)}\`\nAnalysing image…`,
        },
      },
    ],
  };
}

function formatDamageAnalysisSummaryBlocks({ claimId, fileName, result, claim }) {
  if (!result?.ok) {
    const detail = result?.message || "Vision analysis unavailable";
    return {
      text: `Damage review failed: ${fileName}`,
      blocks: [
        sectionMrkdwn(
          `:warning: *${fileName}* — ${truncate(detail, 120)}`
        ),
      ].filter(Boolean),
    };
  }

  const a = result.analysis || {};
  const vehicle = a.vehicle || {};
  const plate = a.registrationPlate || {};
  const vehicleLine = compactVehicleLabel(vehicle) || "_unidentified_";
  const registrationLine = formatRegistrationField(plate, claim);
  const fraudSignals = asBulletList(a.fraudSignals, 2);
  const action = truncate(asText(a.suggestedAction).trim(), 120);
  const severity = asText(a.severity).trim();
  const impact = asText(a.impactZone).trim();
  const detectedReg = asText(plate.text).trim();

  const blocks = [
    fieldsSection([
      { label: "Severity", value: severity || "—" },
      { label: "Impact", value: impact || "—" },
      { label: "Vehicle", value: vehicleLine },
      { label: "VRM (detected)", value: registrationLine },
    ]),
  ].filter(Boolean);

  if (fraudSignals.length) {
    blocks.push(
      sectionMrkdwn(
        `*Top signals*\n${fraudSignals.map((signal) => `• ${truncate(signal, 100)}`).join("\n")}`
      )
    );
  }

  if (action) {
    blocks.push(contextElements([`*Action:* ${action}`]));
  }

  blocks.push(contextElements([fileName]));

  const textParts = [
    `Damage ${claimId}`,
    severity || null,
    detectedReg && !["null", "not_readable"].includes(detectedReg.toLowerCase())
      ? `VRM ${detectedReg.toUpperCase()}`
      : null,
    fraudSignals[0] ? truncate(fraudSignals[0], 60) : null,
  ].filter(Boolean);

  return {
    text: truncate(textParts.join(" · "), 200),
    blocks,
  };
}

function formatDamageAnalysisCanvasMarkdown({ claimId, fileName, result }) {
  if (!result?.ok) {
    const detail = result?.message || "Vision analysis unavailable";
    return [
      `### Damage image · ${fileName}`,
      "",
      `:warning: Could not analyse \`${fileName}\`.`,
      "",
      detail,
    ].join("\n");
  }

  const a = result.analysis || {};
  const vehicle = a.vehicle || {};
  const plate = a.registrationPlate || {};
  const summary = asText(a.damageSummary) || "No summary returned.";
  const vehicleLine = compactVehicleLabel(vehicle);
  const plateLine = compactPlateLabel(plate);
  const panels = asBulletList(a.panelsAffected, 12);
  const fraudSignals = asBulletList(a.fraudSignals, 12);
  const vehicleWarning = asText(vehicle.identificationWarning).trim();
  const action = asText(a.suggestedAction).trim();
  const lines = [
    `### Damage image · ${fileName}`,
    "",
    summary,
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Impact | ${asText(a.impactZone).trim() || "—"} |`,
    `| Severity | ${asText(a.severity).trim() || "—"} |`,
    `| Vehicle | ${vehicleLine || "_could not identify_"} |`,
    `| Plate | ${plateLine || "—"} |`,
    `| Collision type | ${asText(a.likelyCollisionType).trim() || "—"} |`,
    `| Panels | ${panels.length ? panels.join(", ") : "—"} |`,
    `| Model | \`${result.model}\` |`,
  ];

  if (vehicleWarning) {
    lines.push("", `:warning: ${vehicleWarning}`);
  }

  if (fraudSignals.length) {
    lines.push("", "**Fraud signals**", "");
    for (const signal of fraudSignals) {
      lines.push(`- ${signal}`);
    }
  }

  if (action) {
    lines.push("", `**Suggested action:** ${action}`);
  }

  lines.push("", demoDisclaimer());
  return lines.join("\n");
}

function formatDamageAnalysisBlocks({ claimId, fileName, result }) {
  if (!result?.ok) {
    const detail = result?.message || "Vision analysis unavailable";
    return {
      text: `Damage image review failed: ${fileName}`,
      blocks: [
        headerBlock("Damage image review"),
        sectionMrkdwn(
          `:warning: Could not analyse \`${fileName}\`.\n${truncate(detail, 500)}`
        ),
      ].filter(Boolean),
    };
  }

  const a = result.analysis || {};
  const vehicle = a.vehicle || {};
  const plate = a.registrationPlate || {};
  const summary = truncate(asText(a.damageSummary) || "No summary returned.", SUMMARY_MAX);
  const vehicleLine = compactVehicleLabel(vehicle);
  const plateLine = compactPlateLabel(plate);
  const panels = asBulletList(a.panelsAffected, 6);
  const fraudSignals = asBulletList(a.fraudSignals, 3);
  const vehicleWarning = asText(vehicle.identificationWarning).trim();
  const action = truncate(asText(a.suggestedAction).trim(), 280);

  const blocks = [
    headerBlock(`Vehicle damage analysis · ${claimId}`),
    sectionMrkdwn(summary),
    fieldsSection([
      { label: "Impact", value: asText(a.impactZone).trim() || null },
      { label: "Severity", value: asText(a.severity).trim() || null },
      { label: "Vehicle", value: vehicleLine || "_could not identify_" },
      { label: "Plate", value: plateLine },
      {
        label: "Collision",
        value: asText(a.likelyCollisionType).trim() || null,
      },
      {
        label: "Panels",
        value: panels.length ? truncate(panels.join(", "), 200) : null,
      },
    ]),
  ].filter(Boolean);

  if (vehicleWarning) {
    blocks.push(sectionMrkdwn(`:warning: ${truncate(vehicleWarning, 280)}`));
  }

  if (fraudSignals.length) {
    blocks.push({ type: "divider" });
    blocks.push(
      sectionMrkdwn(
        `*Fraud signals*\n${fraudSignals.map((signal) => `• ${signal}`).join("\n")}`
      )
    );
  }

  if (action) {
    blocks.push(sectionMrkdwn(`*Suggested action:* ${action}`));
  }

  const providerLabel = useOpenAiVision() ? "OpenAI" : "Ollama";
  const meta = contextElements([
    fileName,
    `${providerLabel} \`${result.model}\``,
    demoDisclaimer().replace(/^_|_$/g, ""),
  ]);
  if (meta) blocks.push(meta);

  const severity = asText(a.severity).trim();
  const textParts = [`Damage analysis ${claimId}`, severity ? severity : null, fileName].filter(
    Boolean
  );

  return {
    text: truncate(textParts.join(" · "), 300),
    blocks,
  };
}

function formatDamageAnalysisReply({ claimId, fileName, result }) {
  return formatDamageAnalysisBlocks({ claimId, fileName, result }).text;
}

module.exports = {
  buildDamageAnalysisAckCard,
  formatDamageAnalysisReply,
  formatDamageAnalysisBlocks,
  formatDamageAnalysisSummaryBlocks,
  formatDamageAnalysisCanvasMarkdown,
};
