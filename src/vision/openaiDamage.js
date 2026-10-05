const config = require("../config");
const {
  buildClaimContext,
  extractJson,
  finalizeDamageAnalysis,
} = require("./ollamaDamage");

const COMBINED_PROMPT = `You are a UK motor insurance fraud analyst reviewing a vehicle damage photo.

Respond with JSON only (no markdown fences):
{
  "vehicle": {
    "make": "manufacturer or unclear",
    "model": "model name or unclear",
    "generation": "approximate generation if known, else null",
    "bodyStyle": "hatchback|saloon|estate|SUV|coupe|van|unclear",
    "colour": "primary exterior colour",
    "contrastingRoof": true,
    "identificationConfidence": "high|medium|low",
    "identificationEvidence": ["visible badge, grille, silhouette, wheel cap evidence only"]
  },
  "registrationPlate": {
    "text": "exact plate characters left-to-right including spaces, or null",
    "country": "UK|Germany|France|other|unclear",
    "confidence": "high|medium|low|not_readable",
    "notes": "why unreadable if applicable"
  },
  "damageSummary": "2-3 sentence description of visible damage",
  "impactZone": "front|rear|side|roof|multiple|unclear",
  "severity": "minor|moderate|heavy|total_loss",
  "panelsAffected": ["bonnet", "bumper"],
  "likelyCollisionType": "brief description",
  "visibleCues": ["observable facts"],
  "fraudSignals": ["staging, vehicle mismatch, pre-existing damage"],
  "consistencyChecks": ["reconcile photo vs claim context"],
  "suggestedAction": "one concrete next step"
}

Rules:
- Only name a make/model if you see badge, logo, or unmistakable styling evidence.
- Set model to the most specific model LINE supported by evidence (e.g. "GLE Coupe", "C-Class", "CLK") — never use body style alone (suv, saloon, coupe) as the model field.
- Mercedes-Benz: the three-pointed star on the front grille is definitive make evidence. Then identify model line from silhouette, grille, and headlamp shape:
  • A-Class — compact hatch, short overhang, small footprint
  • C-Class — mid-size saloon/coupe/estate; trapezoidal grille (W205/W206 era)
  • E-Class — executive saloon; W210 (1995–2002): twin round headlamps, boxy saloon; W212/W213: more angular single-lens headlamps
  • CLK — 2-door coupe/cabriolet (1990s–2000s), rounded body, no B-pillar on cabriolet
  • GLC — compact SUV, shorter than GLE
  • GLE — large SUV, upright rear; GLE Coupe — sloping/fastback roofline on large SUV
  • ML-Class — older name for GLE (pre-2015)
- BMW: use series numbers when styling supports it (1 Series hatch, 3 Series saloon, X5 SUV).
- Range Rover: distinguish Evoque (compact SUV) from Sport/Velar (coupe-SUV roofline).
- UK registration plates (VRM): transcribe every visible character on the physical plate, preserving spaces (e.g. X568 HJB, OE17 AXW). Set confidence to high when clearly legible.
- Always populate identificationEvidence with badge, grille, headlamp shape, roofline, and body silhouette cues used for model line.
- Never copy insured registration from claim context unless clearly visible on a physical plate.
- Compare insured vehicle details from claim context and flag mismatches as fraud signals.
- When model line is uncertain, set model to "unclear" but still record bodyStyle and any generation hint (e.g. "W210 era").`;

function imageMime(buffer, options = {}) {
  if (options.mimetype) return options.mimetype;
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return "image/png";
  if (buffer[0] === 0x47 && buffer[1] === 0x49) return "image/gif";
  if (buffer[8] === 0x57 && buffer[9] === 0x45) return "image/webp";
  return "image/jpeg";
}

async function openaiAvailable() {
  if (!config.openaiApiKey) return false;
  const base = config.openaiBaseUrl.replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${config.openaiApiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch {
    return Boolean(config.openaiApiKey);
  }
}

async function openaiVisionChat(imageBuffer, userText, options = {}) {
  const model = options.model || config.openaiVisionModel;
  const mime = imageMime(imageBuffer, options);
  const dataUrl = `data:${mime};base64,${imageBuffer.toString("base64")}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || config.openaiTimeoutMs);

  try {
    const base = config.openaiBaseUrl.replace(/\/$/, "");
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: userText },
              { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, message: `OpenAI ${res.status}: ${errText.slice(0, 240)}` };
    }

    const payload = await res.json();
    const content = payload?.choices?.[0]?.message?.content || "";
    return { ok: true, content };
  } catch (err) {
    const message =
      err.name === "AbortError"
        ? `OpenAI vision timed out after ${options.timeoutMs || config.openaiTimeoutMs}ms`
        : err.message || String(err);
    return { ok: false, message };
  } finally {
    clearTimeout(timeout);
  }
}

async function analyzeVehicleDamage(imageBuffer, options = {}) {
  if (!config.openaiApiKey) {
    return { ok: false, reason: "missing_key", message: "OpenAI API key not configured" };
  }

  const claim = options.claim || null;
  const caption = options.caption || "";
  const model = options.model || config.openaiVisionModel;
  const claimContext = buildClaimContext(claim);

  const userText = [
    COMBINED_PROMPT,
    claimContext ? `\nClaim context:\n${claimContext}` : "",
    caption ? `\nUploader caption:\n${caption}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const chat = await openaiVisionChat(imageBuffer, userText, { ...options, model, mimetype: options.mimetype });
  if (!chat.ok) {
    return { ok: false, reason: "request_failed", message: chat.message };
  }

  try {
    const parsed = extractJson(chat.content);
    const analysis = finalizeDamageAnalysis(parsed, claim);
    return {
      ok: true,
      model,
      provider: "openai",
      analysis,
      raw: chat.content,
    };
  } catch (err) {
    return { ok: false, reason: "parse_error", message: err.message || String(err) };
  }
}

module.exports = {
  analyzeVehicleDamage,
  openaiAvailable,
};
