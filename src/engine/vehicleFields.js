const UK_VEHICLES = require("../../data/uk_vehicles.json");

const MODEL_BODY_STYLE = {
  fiesta: "hatchback",
  focus: "hatchback",
  corsa: "hatchback",
  astra: "hatchback",
  golf: "hatchback",
  polo: "hatchback",
  cooper: "hatchback",
  "1 series": "hatchback",
  "3 series": "saloon",
  a3: "hatchback",
  a4: "saloon",
  "c-class": "saloon",
  "a-class": "hatchback",
  yaris: "hatchback",
  corolla: "hatchback",
  qashqai: "suv",
  civic: "hatchback",
  208: "hatchback",
  clio: "hatchback",
  evoque: "suv",
  "model 3": "saloon",
  sportage: "suv",
  i30: "hatchback",
};

const BODY_STYLE_CONFLICTS = {
  coupe: ["suv", "hatchback", "estate", "van"],
  suv: ["coupe", "convertible"],
  hatchback: ["coupe"],
  saloon: ["suv"],
  estate: ["coupe"],
};

const INSURED_VEHICLE_NOTE_RE =
  /\[Claims Fraud Agent\]\s*Insured vehicle:\s*([^(]+?)(?:\s*\(make=([^;]+);\s*model=([^;]+);\s*colour=([^;]+);\s*registration=([^)]+)\))?/i;

function normalizeToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
}

function normalizePlate(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function randomPlateSuffix(seed) {
  const letters = "ABCDEFGHJKLMNOPRSTUVWXYZ";
  const n = Number(seed) || 0;
  return (
    letters[n % letters.length] +
    letters[(n + 3) % letters.length] +
    letters[(n + 7) % letters.length]
  );
}

function buildRegistration(regPrefix, year, seed) {
  const yy = String(year || new Date().getFullYear()).slice(-2);
  return `${regPrefix}${yy} ${randomPlateSuffix(seed)}`;
}

function parseLegacyVehicleString(vehicle) {
  const raw = String(vehicle || "").trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4})\s+(.+)$/);
  if (!match) return { make: null, model: raw, year: null };
  const rest = match[2].trim();
  const parts = rest.split(/\s+/);
  if (parts.length >= 3 && parts[0] === "Range" && parts[1] === "Rover") {
    return { year: Number(match[1]), make: "Range Rover", model: parts.slice(2).join(" ") };
  }
  if (parts.length >= 2 && parts[0] === "Mercedes") {
    return { year: Number(match[1]), make: "Mercedes-Benz", model: parts.slice(1).join(" ") };
  }
  return { year: Number(match[1]), make: parts[0], model: parts.slice(1).join(" ") };
}

function buildInsuredVehicleNote({ make, model, colour, registration }) {
  const label = [make, model].filter(Boolean).join(" ");
  const detail = [
    `make=${make || "unclear"}`,
    `model=${model || "unclear"}`,
    `colour=${colour || "unclear"}`,
    `registration=${registration || "unclear"}`,
  ].join("; ");
  return `[Claims Fraud Agent] Insured vehicle: ${label} · ${colour || "unclear"} · ${registration || "unclear"} (${detail})`;
}

function parseInsuredVehicleFromNotes(notes) {
  if (!notes) return null;
  const match = String(notes).match(INSURED_VEHICLE_NOTE_RE);
  if (!match) return null;
  return {
    label: match[1].trim(),
    make: match[2]?.trim() || null,
    model: match[3]?.trim() || null,
    colour: match[4]?.trim() || null,
    registration: match[5]?.trim() || null,
    source: "salesforce_claim_notes",
  };
}

function inferInsuredBodyStyle(claim) {
  if (!claim) return null;
  const modelKey = normalizeToken(claim.vehicleModel);
  if (modelKey && MODEL_BODY_STYLE[modelKey]) return MODEL_BODY_STYLE[modelKey];

  const labelKey = normalizeToken([claim.vehicleMake, claim.vehicleModel].filter(Boolean).join(" "));
  for (const [model, style] of Object.entries(MODEL_BODY_STYLE)) {
    if (labelKey.includes(model)) return style;
  }

  const uk = UK_VEHICLES.find(
    (entry) =>
      normalizeToken(entry.make) === normalizeToken(claim.vehicleMake) &&
      normalizeToken(entry.model) === normalizeToken(claim.vehicleModel)
  );
  if (uk?.bodyStyle) return uk.bodyStyle;

  if (/suv|qashqai|sportage|evoque|discovery|x5|x3/i.test(String(claim.vehicle || ""))) return "suv";
  return null;
}

function bodyStylesConflict(insuredStyle, detectedStyle) {
  const a = normalizeToken(insuredStyle);
  const b = normalizeToken(detectedStyle);
  if (!a || !b || a === "unclear" || b === "unclear") return false;
  if (a === b) return false;
  const conflicts = BODY_STYLE_CONFLICTS[a] || [];
  return conflicts.includes(b) || (BODY_STYLE_CONFLICTS[b] || []).includes(a);
}

function enrichClaimVehicle(claim) {
  if (!claim) return null;
  const fromNotes = parseInsuredVehicleFromNotes(claim.internalNotes);
  const legacy = parseLegacyVehicleString(claim.vehicle);

  const make = claim.vehicleMake || fromNotes?.make || legacy?.make || null;
  const model = claim.vehicleModel || fromNotes?.model || legacy?.model || null;
  const colour = claim.vehicleColour || fromNotes?.colour || claim.vehicleColor || null;
  const registration =
    claim.vehicleRegistration || fromNotes?.registration || null;

  const enriched = {
    ...claim,
    vehicleMake: make,
    vehicleModel: model,
    vehicleColour: colour,
    vehicleRegistration: registration,
    vehicleYear: claim.vehicleYear || legacy?.year || null,
    insuredVehicleLabel:
      fromNotes?.label ||
      [make, model].filter(Boolean).join(" ") ||
      claim.vehicle ||
      null,
  };
  enriched.insuredBodyStyle = inferInsuredBodyStyle(enriched);
  return enriched;
}

function vehicleFromUkCatalog(index, year = 2019) {
  const entry = UK_VEHICLES[index % UK_VEHICLES.length];
  return {
    make: entry.make,
    model: entry.model,
    colour: entry.colour,
    vehicleYear: year,
    vehicleRegistration: buildRegistration(entry.regPrefix, year, index),
    vehicle: `${year} ${entry.make} ${entry.model}`,
  };
}

module.exports = {
  UK_VEHICLES,
  MODEL_BODY_STYLE,
  INSURED_VEHICLE_NOTE_RE,
  normalizePlate,
  normalizeToken,
  buildRegistration,
  buildInsuredVehicleNote,
  parseInsuredVehicleFromNotes,
  parseLegacyVehicleString,
  inferInsuredBodyStyle,
  bodyStylesConflict,
  enrichClaimVehicle,
  vehicleFromUkCatalog,
};
