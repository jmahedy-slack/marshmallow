const config = require("../config");
const { withOllamaLock } = require("./ollamaQueue");

const VEHICLE_ID_PROMPT = `You are a vehicle identification expert for UK motor insurance claims. Study this image carefully.

Identify the vehicle and registration plate. Respond with JSON only (no markdown fences):
{
  "vehicle": {
    "make": "manufacturer or unclear",
    "model": "model name or unclear",
    "generation": "approximate generation if known, else null",
    "bodyStyle": "hatchback|saloon|estate|SUV|coupe|van|unclear",
    "colour": "primary exterior colour",
    "contrastingRoof": true,
    "identificationConfidence": "high|medium|low",
    "identificationEvidence": ["list ONLY visual evidence you can see — badge text, logo shape, wheel cap lettering, grille design, body silhouette, door hinge type"]
  },
  "registrationPlate": {
    "text": "exact characters left-to-right, or null",
    "country": "UK|Germany|France|other|unclear",
    "confidence": "high|medium|low|not_readable",
    "notes": "why unreadable if applicable"
  }
}

CRITICAL identification rules:
1. Only name a make if you SEE a badge, logo, or unmistakable brand styling. "MINI" text on wheel hub caps = MINI. BMW roundel on bonnet = BMW.
2. MINI Cooper/Hatch: very compact, short bonnet, round headlights, chrome grille surround, often contrasting roof colour, "MINI" on wheel centres.
3. Mercedes-Benz: three-pointed star on the front grille is definitive make evidence. Then identify model LINE (A-Class, C-Class, E-Class, CLK, GLC, GLE, GLE Coupe) from silhouette — never use suv/saloon/coupe alone as the model field.
4. Ford Focus/Fiesta: Ford oval badge on grille — do NOT guess Ford without clearly seeing the Ford oval badge intact on the grille.
5. BMW: kidney grilles + BMW roundel; use series (1/3/5/X5) when styling supports it.
6. Range Rover Evoque: compact luxury SUV — high roofline, 5-door hatch shape, NOT a low-slung 2-door coupe.
7. Rolls-Royce: ultra-luxury coupe/saloon — very long bonnet, upright grille (Spirit of Ecstasy), rear-hinged "suicide" doors, bespoke wheel centres; often Mansory or other tuner wheel caps on modified examples.
8. Vauxhall/Opel: Griffin badge on grille. Volkswagen: VW logo on grille.
9. If the front bumper, grille, and headlights are destroyed or missing, you CANNOT cite "badge on grille" — inspect wheel centre caps, door shape, roofline, and body proportions instead.
10. When uncertain, set make and model to "unclear" and confidence to "low". Never invent a make to fill the field.
11. Always list badge, grille, headlamp shape, roofline, and silhouette cues in identificationEvidence.
12. Registration plate: transcribe ONLY characters visible on a physical plate in the image. NEVER copy a registration from claim context text. null if no plate is visible.`;

const DAMAGE_PROMPT = `You are a motor insurance fraud analyst reviewing vehicle damage photos for a UK/European claims investigation.

Analyse the image and respond with JSON only (no markdown fences):
{
  "damageSummary": "2-3 sentence description of visible damage",
  "impactZone": "front|rear|side|roof|multiple|unclear",
  "severity": "minor|moderate|heavy|total_loss",
  "panelsAffected": ["bonnet", "bumper", "..."],
  "likelyCollisionType": "brief description",
  "visibleCues": ["observable facts — badges, stickers, environment"],
  "fraudSignals": ["staging, vehicle mismatch with claim, pre-existing damage"],
  "consistencyChecks": ["reconcile photo vs FNOL and pre-identified vehicle if provided"],
  "suggestedAction": "one concrete next step"
}

Focus on damage and fraud. Vehicle identification is provided separately — do not contradict it unless the image clearly shows otherwise.
If insured vehicle details are in claim context, actively compare body style and brand — flag vehicle mismatch (e.g. coupe vs insured SUV) as a fraud signal.
Never report the insured registration as the detected plate unless it is clearly legible on a physical plate in the image.`;

function buildClaimContext(claim) {
  if (!claim) return "";
  const lines = [`Claim reference: ${claim.id}`];
  if (claim.claimType) lines.push(`Claim type: ${claim.claimType}`);
  if (claim.dateOfLoss) lines.push(`Date of loss: ${claim.dateOfLoss}`);
  if (claim.description) lines.push(`Reported incident: ${claim.description.slice(0, 300)}`);
  if (claim.locationOfIncident) lines.push(`Incident location: ${claim.locationOfIncident}`);
  if (claim.claimValueGbp) lines.push(`Estimated loss: £${claim.claimValueGbp}`);
  if (claim.vehicleMake) lines.push(`Insured vehicle make: ${claim.vehicleMake}`);
  if (claim.vehicleModel) lines.push(`Insured vehicle model: ${claim.vehicleModel}`);
  if (claim.vehicleRegistration) lines.push(`Insured registration: ${claim.vehicleRegistration}`);
  return lines.join("\n");
}

function extractJson(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let candidate = fenced ? fenced[1].trim() : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) candidate = candidate.slice(start, end + 1);

  const attempts = [
    candidate,
    candidate.replace(/,\s*([}\]])/g, "$1"),
    candidate.replace(/'/g, '"'),
  ];

  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch {
      /* try next */
    }
  }
  throw new Error("Vision response was not valid JSON");
}

function evidenceText(vehicle, supplemental = []) {
  const items = [
    ...(vehicle?.identificationEvidence ? asArray(vehicle.identificationEvidence) : []),
    ...asArray(supplemental),
  ];
  if (!items.length) return "";
  return items.join(" ").toLowerCase();
}

function badgeSupportsMake(make, evidence) {
  const m = String(make || "").toLowerCase().trim();
  if (!m || m === "unclear") return false;
  const aliases = {
    mini: ["mini"],
    bmw: ["bmw", "roundel", "kidney grille"],
    ford: ["ford", "ford oval"],
    vauxhall: ["vauxhall", "griffin"],
    volkswagen: ["volkswagen", "vw logo", "vw badge"],
    audi: ["audi", "four rings"],
    mercedes: ["mercedes", "three-pointed", "three pointed", "benz", "star emblem", "star on grille", "grille star"],
    "mercedes-benz": ["mercedes", "three-pointed", "three pointed", "benz", "star emblem", "star on grille", "grille star"],
    toyota: ["toyota"],
    nissan: ["nissan"],
    honda: ["honda"],
    peugeot: ["peugeot", "lion"],
    renault: ["renault", "diamond"],
    "range rover": ["range rover", "land rover"],
    "rolls-royce": ["rolls-royce", "rolls royce", "spirit of ecstasy"],
    "rolls royce": ["rolls-royce", "rolls royce", "spirit of ecstasy"],
    tesla: ["tesla"],
    mansory: ["mansory"],
  };
  const keys = aliases[m] || [m];
  return keys.some((k) => evidence.includes(k));
}

function evidenceCitesGrilleBadge(evidence) {
  return /grille|front badge|bonnet badge|hood badge|oval badge|star emblem|star on grille|grille star|manufacturer badge|mercedes star/.test(
    evidence
  );
}

function evidenceCitesFrontDestroyed(evidence) {
  return /missing|destroyed|absent|no (front|grille|bumper|headlight)|severely crush|completely|disassembl|partial disassembly/.test(
    evidence
  );
}

function luxuryCoupeHints(evidence) {
  return /mansory|rolls[\s-]?royce|spirit of ecstasy|suicide door|rear-hinged door|forged carbon|ultra.?luxury|two.?door luxury|long bonnet/.test(
    evidence
  );
}

function sanitizeRegistrationPlate(plate, claim) {
  if (!plate) return plate;
  const text = String(plate.text || "").trim();
  if (!text || ["null", "not_readable", "unreadable", "n/a", "none"].includes(text.toLowerCase())) {
    return plate;
  }

  const insuredReg = claim?.vehicleRegistration;
  if (insuredReg) {
    const { normalizePlate } = require("../engine/vehicleFields");
    if (normalizePlate(text) === normalizePlate(insuredReg)) {
      return {
        ...plate,
        text: null,
        confidence: "not_readable",
        notes:
          "Registration not verified in image — rejected likely copy of insured plate from claim context",
      };
    }
  }

  const conf = String(plate.confidence || "").toLowerCase();
  if (conf === "high" && plate.notes && /not visible|obscured|missing|no plate/i.test(plate.notes)) {
    return {
      ...plate,
      text: null,
      confidence: "not_readable",
    };
  }

  return plate;
}

const BODY_STYLE_WORDS = new Set([
  "hatchback",
  "saloon",
  "estate",
  "suv",
  "coupe",
  "van",
  "unclear",
]);

function sanitizeModelAndBodyStyle(vehicle) {
  if (!vehicle) return vehicle;
  const normalized = { ...vehicle };
  const model = String(normalized.model || "").trim().toLowerCase();
  if (BODY_STYLE_WORDS.has(model)) {
    if (!fieldReadable(normalized.bodyStyle) || normalized.bodyStyle === "unclear") {
      normalized.bodyStyle = model;
    }
    normalized.model = "unclear";
  }
  return normalized;
}

function sanitizeBodyStyleValue(bodyStyle, vehicle, fraudSignals) {
  const raw = String(bodyStyle || "").trim().toLowerCase();
  const evidence = evidenceText(vehicle || {});
  const signals = asArray(fraudSignals).join(" ").toLowerCase();

  if (raw.includes("|")) {
    if (/coupe|two.door|low.slung|luxury coupe/.test(signals) || luxuryCoupeHints(evidence)) return "coupe";
    if (/suv|high roof/.test(signals)) return "suv";
    const parts = raw.split("|").map((p) => p.trim()).filter((p) => p && p !== "unclear");
    return parts.length === 1 ? parts[0] : "unclear";
  }

  if (!raw || raw === "unclear") {
    if (/coupe|two.door|luxury coupe/.test(signals) || luxuryCoupeHints(evidence)) return "coupe";
    return "unclear";
  }

  return raw;
}

function normalizeVehicleIdentification(vehicle, fraudSignals, supplementalEvidence = []) {
  if (!vehicle) return vehicle;
  const normalized = { ...vehicle };
  if (normalized.make == null || String(normalized.make).toLowerCase() === "null") {
    normalized.make = "unclear";
  }
  if (normalized.model == null || String(normalized.model).toLowerCase() === "null") {
    normalized.model = "unclear";
  }
  const evidence = evidenceText(normalized, supplementalEvidence);
  const make = String(normalized.make || "").trim();
  const conf = String(normalized.identificationConfidence || "").toLowerCase();

  if (evidenceCitesGrilleBadge(evidence) && evidenceCitesFrontDestroyed(evidence)) {
    normalized.make = "unclear";
    normalized.model = "unclear";
    normalized.identificationConfidence = "low";
    normalized.identificationWarning =
      "Front grille/bumper appears destroyed — grille badge evidence rejected. Check wheel centre caps and body silhouette.";
  }

  const makeLower = make.toLowerCase();
  if (
    (makeLower === "ford" || normalized.bodyStyle?.toLowerCase() === "suv") &&
    luxuryCoupeHints(evidence)
  ) {
    normalized.make = luxuryCoupeHints(evidence) && /rolls/.test(evidence) ? "Rolls-Royce" : "unclear";
    normalized.model = "unclear";
    normalized.bodyStyle = normalized.bodyStyle === "suv" ? "coupe" : normalized.bodyStyle || "coupe";
    if (normalized.make === "unclear") {
      normalized.identificationWarning =
        "Luxury coupe cues detected (long bonnet, suicide doors, Mansory caps) — not consistent with mass-market SUV/hatch identification.";
    }
  }

  const strictBadgeCheck = conf === "low" || !conf;
  if (
    make &&
    make.toLowerCase() !== "unclear" &&
    strictBadgeCheck &&
    !badgeSupportsMake(make, evidence)
  ) {
    normalized.make = "unclear";
    normalized.model = "unclear";
    normalized.identificationConfidence = "low";
    normalized.identificationWarning =
      `Model guessed "${make}" without visible badge evidence — marked unclear. Check wheel caps, grille badges, and body shape manually.`;
  } else if (make && make.toLowerCase() !== "unclear" && badgeSupportsMake(make, evidence)) {
    if (conf === "low") normalized.identificationConfidence = "medium";
  } else if (conf === "high" && !evidence) {
    normalized.identificationConfidence = "medium";
  }

  normalized.bodyStyle = sanitizeBodyStyleValue(normalized.bodyStyle, normalized, fraudSignals);
  return sanitizeModelAndBodyStyle(normalized);
}

async function ollamaAvailable(baseUrl = config.ollamaBaseUrl, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) return true;
    } catch {
      if (attempt < retries) await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return false;
}

async function ollamaVisionChat(imageBuffer, userText, options = {}) {
  const baseUrl = options.baseUrl || config.ollamaBaseUrl;
  const model = options.model || config.ollamaVisionModel;

  const body = {
    model,
    stream: false,
    messages: [
      {
        role: "user",
        content: userText,
        images: [imageBuffer.toString("base64")],
      },
    ],
  };
  if (options.jsonFormat) body.format = "json";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || config.ollamaTimeoutMs);

  try {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, message: `Ollama ${res.status}: ${errText.slice(0, 200)}` };
    }

    const payload = await res.json();
    return { ok: true, content: payload?.message?.content || "" };
  } catch (err) {
    const message =
      err.name === "AbortError"
        ? `Ollama vision timed out after ${options.timeoutMs || config.ollamaTimeoutMs}ms`
        : err.message || String(err);
    return { ok: false, message };
  } finally {
    clearTimeout(timeout);
  }
}

async function identifyVehicle(imageBuffer, options = {}) {
  const claimContext = buildClaimContext(options.claim);
  const userText = [
    VEHICLE_ID_PROMPT,
    claimContext ? `\nClaim context (compare if insured vehicle known):\n${claimContext}` : "",
    options.caption ? `\nUploader caption:\n${options.caption}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const chat = await ollamaVisionChat(imageBuffer, userText, { ...options, jsonFormat: true });
  if (!chat.ok) return { ok: false, message: chat.message };

  try {
    const parsed = extractJson(chat.content);
    const vehicle = normalizeVehicleIdentification(parsed.vehicle || {}, []);
    const registrationPlate = sanitizeRegistrationPlate(parsed.registrationPlate || {}, options.claim);
    return {
      ok: true,
      vehicle,
      registrationPlate,
    };
  } catch (err) {
    return { ok: false, message: err.message || String(err) };
  }
}

async function analyzeVehicleDamage(imageBuffer, options = {}) {
  return withOllamaLock("analyzeVehicleDamage", () =>
    analyzeVehicleDamageInner(imageBuffer, options)
  );
}

async function analyzeVehicleDamageInner(imageBuffer, options = {}) {
  if (!config.ollamaEnabled) {
    return { ok: false, reason: "disabled", message: "Ollama vision is disabled in config" };
  }

  const baseUrl = options.baseUrl || config.ollamaBaseUrl;
  const model = options.model || config.ollamaVisionModel;
  const claim = options.claim || null;
  const caption = options.caption || "";

  const up = await ollamaAvailable(baseUrl);
  if (!up) {
    return {
      ok: false,
      reason: "unavailable",
      message: `Ollama not reachable at ${baseUrl}. Run: ollama serve && ollama pull ${model}`,
    };
  }

  const vehicleId = await identifyVehicle(imageBuffer, { ...options, claim, caption, baseUrl, model });

  const claimContext = buildClaimContext(claim);
  const vehicleContext = vehicleId.ok
    ? `\nPre-identified vehicle (from dedicated ID pass):\n${JSON.stringify(
        {
          vehicle: vehicleId.vehicle,
          registrationPlate: vehicleId.registrationPlate,
        },
        null,
        2
      )}`
    : "";

  const userText = [
    DAMAGE_PROMPT,
    claimContext ? `\nClaim context:\n${claimContext}` : "",
    vehicleContext,
    caption ? `\nUploader caption:\n${caption}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const chat = await ollamaVisionChat(imageBuffer, userText, { ...options, baseUrl, model, jsonFormat: true });
  if (!chat.ok) {
    return { ok: false, reason: "request_failed", message: chat.message };
  }

  try {
    const damage = extractJson(chat.content);
    const analysis = finalizeDamageAnalysis(damage, claim);

    return {
      ok: true,
      model,
      provider: "ollama",
      analysis,
      raw: chat.content,
      vehicleIdRaw: vehicleId.ok ? vehicleId : null,
    };
  } catch (err) {
    return { ok: false, reason: "parse_error", message: err.message || String(err) };
  }
}

function finalizeDamageAnalysis(parsed, claim) {
  const fraudSignals = asArray(parsed.fraudSignals);
  const supplementalEvidence = [
    ...asArray(parsed.visibleCues),
    parsed.damageSummary,
    ...fraudSignals,
    ...asArray(parsed.consistencyChecks),
  ];
  let vehicle = normalizeVehicleIdentification(parsed.vehicle || {}, fraudSignals, supplementalEvidence);
  vehicle = enrichVehicleFromDamageAnalysis(vehicle, parsed);

  const registrationPlate = sanitizeRegistrationPlate(parsed.registrationPlate || {}, claim);

  const analysis = {
    ...parsed,
    vehicle,
    registrationPlate,
  };

  if (vehicle?.identificationWarning) {
    const warnings = asArray(analysis.fraudSignals);
    warnings.unshift(vehicle.identificationWarning);
    analysis.fraudSignals = warnings;
  }

  return analysis;
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [String(value)];
}

function fieldReadable(value) {
  const v = String(value || "").trim();
  return v && v.toLowerCase() !== "unclear" && v.toLowerCase() !== "null";
}

const GENERIC_MODEL_WORDS = new Set([
  "suv",
  "saloon",
  "sedan",
  "coupe",
  "hatchback",
  "estate",
  "van",
  "unclear",
  "null",
]);

function isGenericModel(model) {
  const m = String(model || "").trim().toLowerCase();
  return !m || GENERIC_MODEL_WORDS.has(m);
}

function inferSpecificModel(make, vehicle, text) {
  const makeLower = String(make || "").toLowerCase();
  if (!makeLower.includes("mercedes")) return null;

  const bodyStyle = String(vehicle?.bodyStyle || "").toLowerCase();
  const generation = String(vehicle?.generation || "").toLowerCase();
  const evidence = [
    ...asArray(vehicle?.identificationEvidence),
    generation,
    bodyStyle,
    text,
  ]
    .join(" ")
    .toLowerCase();

  if (/gle coupe|gle-coupe|coupe suv|sloping roof|fastback suv|sportback suv|coupe-like suv/i.test(evidence)) {
    return "GLE Coupe";
  }
  if (/\bgle\b|ml[\s-]?class|\bml 350\b|\bml350\b/i.test(evidence)) return "GLE";
  if (/\bglc\b|\bglk\b/i.test(evidence)) return "GLC";
  if (
    /\bclk\b|clk-class/i.test(evidence) ||
    ((/cabriolet|convertible|soft top|2.door|two.door/.test(evidence) || bodyStyle === "coupe") &&
      /round headl|1990s|2000s|older mercedes/i.test(evidence))
  ) {
    return "CLK";
  }
  if (/w210|\be-class\b|e class|twin.{0,24}headl|double.{0,24}headl|four round headl/i.test(evidence)) {
    return "E-Class";
  }
  if (/\bc-class\b|c class|\bw205\b|\bw206\b/i.test(evidence)) return "C-Class";
  if (/\be-class\b|e class|\bw212\b|\bw213\b/i.test(evidence) && bodyStyle === "saloon") return "E-Class";
  if (/\ba-class\b|a class|compact hatch/i.test(evidence) || bodyStyle === "hatchback") return "A-Class";

  return null;
}

function enrichVehicleFromDamageAnalysis(vehicle, damage) {
  const enriched = { ...(vehicle || {}) };
  const text = [
    damage?.damageSummary,
    ...asArray(damage?.fraudSignals),
    ...asArray(damage?.visibleCues),
    ...asArray(damage?.consistencyChecks),
  ]
    .join(" ")
    .toLowerCase();

  if (!fieldReadable(enriched.bodyStyle)) {
    if (/coupe|two.door|2.door|luxury coupe|low.slung|suicide door|long bonnet/i.test(text)) {
      enriched.bodyStyle = "coupe";
    } else if (/\bsuv\b|high roof|5.door/i.test(text)) {
      enriched.bodyStyle = "suv";
    }
  }

  if (!fieldReadable(enriched.colour)) {
    if (/\bblack\b|dark grey|charcoal/i.test(text)) enriched.colour = "black";
    else if (/\bsilver\b|light grey|light gray/i.test(text)) enriched.colour = "silver";
    else if (/\bgrey\b|\bgray\b/i.test(text)) enriched.colour = "grey";
  }

  if (!fieldReadable(enriched.make)) {
    if (/rolls[\s-]?royce|spirit of ecstasy/i.test(text)) {
      enriched.make = "Rolls-Royce";
      enriched.identificationConfidence = "medium";
    } else if (/mercedes[\s-]?benz|mercedes star|three[\s-]?pointed star|benz star|star emblem on grille/i.test(text)) {
      enriched.make = "Mercedes-Benz";
      enriched.identificationConfidence = enriched.identificationConfidence || "medium";
      const evidence = asArray(enriched.identificationEvidence);
      if (!evidence.some((e) => /mercedes|star|grille badge/i.test(String(e)))) {
        evidence.push("Mercedes-Benz star/badge cited in damage analysis");
      }
      enriched.identificationEvidence = evidence;
    } else if (/mansory/i.test(text)) {
      const evidence = asArray(enriched.identificationEvidence);
      evidence.push("Mansory wheel centre caps");
      enriched.identificationEvidence = evidence;
      enriched.bodyStyle = enriched.bodyStyle || "coupe";
    }
  }

  if (fieldReadable(enriched.make) && isGenericModel(enriched.model)) {
    const inferred = inferSpecificModel(enriched.make, enriched, text);
    if (inferred) {
      enriched.model = inferred;
      const evidence = asArray(enriched.identificationEvidence);
      evidence.push(`Model line inferred from silhouette: ${inferred}`);
      enriched.identificationEvidence = evidence;
      if (String(enriched.identificationConfidence || "").toLowerCase() === "low") {
        enriched.identificationConfidence = "medium";
      }
    }
  }

  return enriched;
}

module.exports = {
  analyzeVehicleDamage,
  identifyVehicle,
  ollamaAvailable,
  buildClaimContext,
  extractJson,
  finalizeDamageAnalysis,
  normalizeVehicleIdentification,
  sanitizeRegistrationPlate,
  badgeSupportsMake,
};
