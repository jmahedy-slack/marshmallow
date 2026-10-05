const { listPatterns } = require("../engine/store");
const { matchPattern } = require("../engine/rules");
const {
  normalizePlate,
  normalizeToken,
  enrichClaimVehicle,
  bodyStylesConflict,
} = require("../engine/vehicleFields");

const COLOUR_ALIASES = {
  grey: ["gray", "silver", "metallic grey", "metallic gray"],
  silver: ["grey", "gray", "metallic silver"],
  red: ["crimson", "maroon", "burgundy"],
  blue: ["navy", "dark blue"],
  black: ["dark", "jet black"],
  white: ["pearl", "ivory"],
  green: ["british racing green", "racing green", "dark green"],
};

function truncate(text, max) {
  const body = String(text || "").trim();
  if (body.length <= max) return body;
  return `${body.slice(0, max - 1)}…`;
}

function headerBlock(text) {
  return {
    type: "header",
    text: { type: "plain_text", text: truncate(text, 150), emoji: true },
  };
}

function sectionMrkdwn(text) {
  const body = truncate(text, 3000);
  if (!body) return null;
  return { type: "section", text: { type: "mrkdwn", text: body } };
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

function tokensMatch(a, b) {
  const left = normalizeToken(a);
  const right = normalizeToken(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) return true;
  const leftParts = left.split(" ").filter(Boolean);
  const rightParts = right.split(" ").filter(Boolean);
  return leftParts.some((p) => rightParts.includes(p));
}

function colourMatches(insured, detected) {
  const a = normalizeToken(insured);
  const b = normalizeToken(detected);
  if (!a || !b || a === "unclear" || b === "unclear") return null;
  if (tokensMatch(a, b)) return true;
  for (const [canonical, aliases] of Object.entries(COLOUR_ALIASES)) {
    const group = [canonical, ...aliases].map(normalizeToken);
    if (group.includes(a) && group.includes(b)) return true;
  }
  return false;
}

function fieldReadable(value) {
  const v = String(value || "").trim();
  return v && v.toLowerCase() !== "unclear" && v.toLowerCase() !== "null";
}

function normalizeBodyStyle(value) {
  const v = normalizeToken(value);
  if (!v) return null;
  if (v === "suv") return "suv";
  if (["coupe", "convertible"].includes(v)) return "coupe";
  return v;
}

function makesConflict(insuredMake, detectedMake) {
  if (!fieldReadable(insuredMake) || !fieldReadable(detectedMake)) return false;
  return !tokensMatch(insuredMake, detectedMake);
}

function insuredSummary(insured) {
  const parts = [
    insured.make,
    insured.model,
    insured.colour,
    insured.registration ? `\`${insured.registration}\`` : null,
  ].filter((p) => fieldReadable(p));
  return parts.join(" · ") || insured.label || null;
}

function detectedSummary(detected) {
  const parts = [
    detected.make,
    detected.model,
    detected.bodyStyle,
    detected.colour,
    detected.registration ? `\`${detected.registration}\`` : null,
  ].filter((p) => fieldReadable(p));
  return parts.length ? parts.join(" · ") : null;
}

function capitalizeDisplay(value) {
  const v = String(value || "").trim();
  if (!v) return v;
  return v
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

const POLICY_FIELD_LABELS = {
  colour: "Vehicle Colour",
  registration: "Vehicle Registration",
  make: "Vehicle Make",
  model: "Vehicle Model",
  bodyStyle: "Vehicle Body Style",
};

function formatPolicyInsuredMessage(field, insuredValue) {
  const label = POLICY_FIELD_LABELS[field] || "Vehicle Detail";
  const value =
    field === "registration"
      ? String(insuredValue || "").trim().toUpperCase()
      : capitalizeDisplay(insuredValue);
  if (!value) return null;
  if (field === "registration") {
    return `Insured ${label}: \`${value}\``;
  }
  return `Insured ${label}: ${value}`;
}

function compareInsuredVsDetected(claim, analysis) {
  const insured = enrichClaimVehicle(claim || {});
  const detected = analysis?.vehicle || {};
  const plate = analysis?.registrationPlate || {};
  const signalText = [
    analysis?.damageSummary,
    ...(Array.isArray(analysis?.fraudSignals) ? analysis.fraudSignals : []),
  ]
    .join(" ")
    .toLowerCase();
  const flags = [];
  const patterns = listPatterns();

  const insuredMake = insured.vehicleMake;
  const insuredModel = insured.vehicleModel;
  const insuredColour = insured.vehicleColour;
  const insuredReg = insured.vehicleRegistration;

  const detectedMake = detected.make;
  const detectedModel = detected.model;
  const detectedColour = detected.colour;
  const detectedBodyStyle = normalizeBodyStyle(detected.bodyStyle);
  const insuredBodyStyle = normalizeBodyStyle(insured.insuredBodyStyle);
  const evidence = Array.isArray(detected.identificationEvidence)
    ? detected.identificationEvidence.join(" ").toLowerCase()
    : String(detected.identificationEvidence || "").toLowerCase();
  const plateText = String(plate.text || "").trim();
  const plateReadable =
    fieldReadable(plateText) &&
    !["not_readable", "unreadable", "n/a"].includes(plateText.toLowerCase());
  const detectedReg = plateReadable ? plateText : null;

  if (fieldReadable(insuredMake) && fieldReadable(detectedMake) && makesConflict(insuredMake, detectedMake)) {
    flags.push({
      field: "make",
      severity: "critical",
      message: formatPolicyInsuredMessage("make", insuredMake),
      insured: insuredMake,
      detected: detectedMake,
    });
  }

  if (
    fieldReadable(insuredMake) &&
    /range rover/i.test(insuredMake) &&
    (/rolls[\s-]?royce|spirit of ecstasy|mansory|coupe silhouette|luxury coupe/i.test(evidence) ||
      detectedBodyStyle === "coupe" ||
      /coupe|two.door|luxury coupe/i.test(signalText))
  ) {
    if (!flags.some((f) => f.field === "make")) {
      flags.push({
        field: "make",
        severity: "critical",
        message: `Insured Vehicle Make: ${capitalizeDisplay(insuredMake)} _(photo: luxury coupe, not SUV)_`,
        insured: insuredMake,
        detected: detectedMake || "luxury coupe (unclear make)",
      });
    }
  }

  if (fieldReadable(insuredModel) && fieldReadable(detectedModel) && !tokensMatch(insuredModel, detectedModel)) {
    const makeAlreadyMismatch = flags.some((f) => f.field === "make");
    if (!makeAlreadyMismatch && !tokensMatch(`${insuredMake} ${insuredModel}`, `${detectedMake} ${detectedModel}`)) {
      flags.push({
        field: "model",
        severity: "high",
        message: formatPolicyInsuredMessage("model", insuredModel),
        insured: insuredModel,
        detected: detectedModel,
      });
    }
  }

  if (fieldReadable(insuredColour) && fieldReadable(detectedColour)) {
    const colourOk = colourMatches(insuredColour, detectedColour);
    if (colourOk === false) {
      flags.push({
        field: "colour",
        severity: "medium",
        message: formatPolicyInsuredMessage("colour", insuredColour),
        insured: insuredColour,
        detected: detectedColour,
      });
    }
  }

  if (insuredBodyStyle && detectedBodyStyle && bodyStylesConflict(insuredBodyStyle, detectedBodyStyle)) {
    flags.push({
      field: "bodyStyle",
      severity: "critical",
      message: `Insured Vehicle Body Style: ${capitalizeDisplay(insuredBodyStyle)} _(photo: ${capitalizeDisplay(detectedBodyStyle)})_`,
      insured: insuredBodyStyle,
      detected: detectedBodyStyle,
    });
  }

  if (
    fieldReadable(insuredMake) &&
    !fieldReadable(detectedMake) &&
    /does not match|discrepancy|mismatch|wrong vehicle|different (make|model|vehicle)|not consistent with insured/i.test(
      signalText
    ) &&
    !flags.some((f) => f.field === "make")
  ) {
    flags.push({
      field: "make",
      severity: "critical",
        message: `Insured Vehicle Identity: ${capitalizeDisplay(insuredMake)} ${capitalizeDisplay(insuredModel)}`,
      insured: `${insuredMake} ${insuredModel || ""}`.trim(),
      detected: "unidentified (analysis flagged mismatch)",
    });
  }

  const hasInsuredIdentity = fieldReadable(insuredMake) && fieldReadable(insuredModel);
  const hasDetectedIdentity =
    fieldReadable(detectedMake) || fieldReadable(detectedModel) || fieldReadable(detectedBodyStyle);

  if (hasInsuredIdentity && !hasDetectedIdentity && !flags.some((f) => f.field === "make")) {
    flags.push({
      field: "make",
      severity: "critical",
      message: `Insured Vehicle Identity: ${capitalizeDisplay(insuredMake)} ${capitalizeDisplay(insuredModel)}`,
      insured: `${insuredMake} ${insuredModel}`.trim(),
      detected: "unidentified — cannot verify match",
    });
  }

  if (fieldReadable(insuredReg) && detectedReg) {
    const insuredNorm = normalizePlate(insuredReg);
    const detectedNorm = normalizePlate(detectedReg);
    if (insuredNorm && detectedNorm && insuredNorm !== detectedNorm) {
      flags.push({
        field: "registration",
        severity: "critical",
        message: formatPolicyInsuredMessage("registration", insuredReg),
        insured: insuredReg,
        detected: detectedReg,
      });
    }
  }

  const hits = flags.map((flag) =>
    matchPattern("VEH-001", patterns, {
      field: flag.field,
      insured: flag.insured,
      detected: flag.detected,
      message: flag.message,
    })
  );

  return {
    insured: {
      make: insuredMake,
      model: insuredModel,
      colour: insuredColour,
      registration: insuredReg,
      label: insured.insuredVehicleLabel,
    },
    detected: {
      make: detectedMake,
      model: detectedModel,
      bodyStyle: detectedBodyStyle,
      colour: detectedColour,
      registration: detectedReg,
      plateConfidence: plate.confidence,
    },
    flags,
    hits,
    consistent: flags.length === 0,
  };
}

function formatVehicleConsistencySummaryBlocks(check) {
  if (!check?.insured?.label && !check?.insured?.make) {
    return {
      text: "Policy vehicle: no record",
      blocks: [
        sectionMrkdwn("_No insured vehicle on Claim__c to compare._"),
      ].filter(Boolean),
    };
  }

  if (check.consistent) {
    if (!fieldReadable(check.detected.make) && !fieldReadable(check.detected.bodyStyle)) {
      return {
        text: "Policy vehicle: identification uncertain",
        blocks: [
          sectionMrkdwn(
            ":warning: *Vehicle not confidently identified* — verify manually before accepting as evidence."
          ),
        ].filter(Boolean),
      };
    }
    return {
      text: "Policy vehicle: consistent",
      blocks: [
        sectionMrkdwn(":white_check_mark: *Policy vehicle* matches Claim__c."),
      ].filter(Boolean),
    };
  }

  const topFlags = check.flags.slice(0, 4).map((flag) => flag.message);
  return {
    text: `Policy vehicle: ${check.flags.length} mismatch(es)`,
    blocks: [
      sectionMrkdwn(
        `:warning: *Policy schedule check*\n${topFlags.map((line) => `• ${line}`).join("\n")}`
      ),
    ].filter(Boolean),
  };
}

function formatVehicleConsistencyCanvasMarkdown(check) {
  if (!check?.insured?.label && !check?.insured?.make) {
    return [
      "## Policy vehicle check",
      "",
      "_No make/model/registration on Claim__c — add insured vehicle details to compare._",
    ].join("\n");
  }

  const insuredLine = insuredSummary(check.insured);
  const detectedLine = detectedSummary(check.detected);
  const lines = [
    "## Policy vehicle check",
    "",
    `- **Insured (Claim__c):** ${insuredLine || "—"}`,
    `- **Detected in photo:** ${detectedLine || "_not confidently identified_"}`,
    "",
  ];

  if (check.consistent) {
    if (!fieldReadable(check.detected.make) && !fieldReadable(check.detected.bodyStyle)) {
      lines.push(
        ":warning: **Vehicle not confidently identified** — manual review before accepting as evidence."
      );
    } else {
      lines.push(":white_check_mark: **No inconsistencies** with Claim__c vehicle details.");
    }
    return lines.join("\n");
  }

  lines.push("**:warning: Inconsistencies flagged**", "");
  for (const flag of check.flags) {
    lines.push(`- **${flag.field}** (${flag.severity}): ${flag.message}`);
  }
  return lines.join("\n");
}

function formatVehicleConsistencyBlocks(check) {
  if (!check?.insured?.label && !check?.insured?.make) {
    return {
      text: "Policy vehicle check: no insured vehicle on record",
      blocks: [
        headerBlock("Policy vehicle check"),
        sectionMrkdwn(
          "_No make/model/registration on Claim__c — add insured vehicle details to compare._"
        ),
      ].filter(Boolean),
    };
  }

  const insuredLine = insuredSummary(check.insured);
  const detectedLine = detectedSummary(check.detected);

  const blocks = [
    headerBlock("Policy vehicle check"),
    fieldsSection([
      { label: "Insured (Claim__c)", value: insuredLine },
      {
        label: "Detected in photo",
        value: detectedLine || "_not confidently identified_",
      },
    ]),
  ].filter(Boolean);

  let text = "Policy vehicle check";

  if (check.consistent) {
    if (!fieldReadable(check.detected.make) && !fieldReadable(check.detected.bodyStyle)) {
      blocks.push(
        sectionMrkdwn(
          ":warning: *Vehicle not confidently identified* — manual review before accepting as evidence."
        )
      );
      text = "Policy vehicle check: identification uncertain";
    } else {
      blocks.push(
        sectionMrkdwn(":white_check_mark: *No inconsistencies* with Claim__c vehicle details.")
      );
      text = "Policy vehicle check: consistent";
    }
  } else {
    const flagLines = check.flags
      .slice(0, 3)
      .map((flag) => `• ${truncate(flag.message, 240)}`)
      .join("\n");
    blocks.push(sectionMrkdwn(`:warning: *Inconsistencies flagged*\n${flagLines}`));
    text = `Policy vehicle check: ${check.flags.length} inconsistency(ies)`;
  }

  return { text, blocks };
}

function formatVehicleConsistencyReply(check) {
  return formatVehicleConsistencyBlocks(check).text;
}

module.exports = {
  compareInsuredVsDetected,
  formatPolicyInsuredMessage,
  formatVehicleConsistencyReply,
  formatVehicleConsistencyBlocks,
  formatVehicleConsistencySummaryBlocks,
  formatVehicleConsistencyCanvasMarkdown,
  colourMatches,
  tokensMatch,
};
