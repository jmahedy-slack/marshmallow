const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const REGISTRY_PATH = path.join(DATA_DIR, "claim_feed_images.json");
const IMAGES_ROOT = path.join(DATA_DIR, "claim_images");
const SHARED_DEMO_FOLDER = "Claim";

const EXT_MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  tiff: "image/tiff",
};

const IMAGE_EXTENSIONS = new Set(Object.keys(EXT_MIME).map((ext) => `.${ext}`));

let registryCache = null;

function loadRegistry() {
  if (registryCache) return registryCache;
  if (!fs.existsSync(REGISTRY_PATH)) {
    registryCache = {};
    return registryCache;
  }
  registryCache = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
  return registryCache;
}

function mimeForFilename(filename) {
  const ext = path.extname(String(filename || "")).slice(1).toLowerCase();
  return EXT_MIME[ext] || "image/jpeg";
}

function normalizeClaimId(claimNumber) {
  return String(claimNumber || "").trim().toUpperCase();
}

function isImageFile(filename) {
  return IMAGE_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

function titleFromFilename(filename) {
  const base = path.basename(filename, path.extname(filename));
  return base.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function resolveRegistryEntries(registry, keys) {
  for (const key of keys) {
    const entries = registry[key];
    if (Array.isArray(entries) && entries.length) return entries;
  }
  return null;
}

function buildImageMeta(entry, absolutePath, source = "local", claimFolder = null) {
  const relPath = entry?.imagePath || entry?.filename || path.basename(absolutePath);
  return {
    title: entry?.title || titleFromFilename(relPath),
    subtitle: entry?.subtitle || null,
    body: entry?.body || null,
    feedTitle: entry?.body || entry?.subtitle || null,
    source: entry?.source || source,
    filename: path.basename(absolutePath),
    absolutePath,
    claimFolder: claimFolder || path.basename(path.dirname(absolutePath)),
    mimeType: mimeForFilename(relPath),
  };
}

function discoverImagesInFolder(folderPath, { entries = null, limit = 10, source = "local" } = {}) {
  if (!fs.existsSync(folderPath)) return [];

  const images = [];

  if (Array.isArray(entries) && entries.length) {
    for (const entry of entries) {
      const relPath = entry.imagePath || entry.filename;
      if (!relPath) continue;

      const absolutePath = path.join(folderPath, relPath);
      if (!fs.existsSync(absolutePath)) continue;

      images.push(buildImageMeta(entry, absolutePath, source));
      if (images.length >= limit) break;
    }
    return images;
  }

  const files = fs
    .readdirSync(folderPath)
    .filter((name) => {
      const absolutePath = path.join(folderPath, name);
      try {
        return isImageFile(name) && fs.statSync(absolutePath).isFile();
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.localeCompare(b));

  for (const filename of files) {
    images.push(buildImageMeta(null, path.join(folderPath, filename), source));
    if (images.length >= limit) break;
  }

  return images;
}

/**
 * Local demo images for claims with no Salesforce feed attachments.
 * Registry: data/claim_feed_images.json (per-claim keys or shared "Claim"/"*")
 * Files: data/claim_images/<claimId>/ then fallback data/claim_images/Claim/
 */
function getLocalClaimFeedImages(claimNumber, { limit = 10 } = {}) {
  const claimId = normalizeClaimId(claimNumber);
  if (!claimId) return [];

  const registry = loadRegistry();
  const claimFolder = path.join(IMAGES_ROOT, claimId);
  const claimEntries = registry[claimId];

  const claimImages = discoverImagesInFolder(claimFolder, {
    entries: claimEntries,
    limit,
    source: "local",
  });
  if (claimImages.length) return claimImages;

  const sharedFolder = path.join(IMAGES_ROOT, SHARED_DEMO_FOLDER);
  const sharedEntries = resolveRegistryEntries(registry, [SHARED_DEMO_FOLDER, "*"]);

  return discoverImagesInFolder(sharedFolder, {
    entries: sharedEntries,
    limit,
    source: "local",
  });
}

function hasLocalClaimFeedImages(claimNumber) {
  return getLocalClaimFeedImages(claimNumber, { limit: 1 }).length > 0;
}

function readLocalClaimImage(imageMeta) {
  if (!imageMeta?.absolutePath) {
    throw new Error("Missing local image path");
  }
  const buffer = fs.readFileSync(imageMeta.absolutePath);
  return {
    buffer,
    mimeType: imageMeta.mimeType || mimeForFilename(imageMeta.filename),
    name: imageMeta.filename || path.basename(imageMeta.absolutePath),
  };
}

module.exports = {
  SHARED_DEMO_FOLDER,
  getLocalClaimFeedImages,
  hasLocalClaimFeedImages,
  readLocalClaimImage,
  mimeForFilename,
};
