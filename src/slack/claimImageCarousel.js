const config = require("../config");
const { downloadClaimImage, MAX_IMAGES } = require("../salesforce/claimImages");
const {
  SHARED_DEMO_FOLDER,
  getLocalClaimFeedImages,
  readLocalClaimImage,
} = require("../data/localClaimImages");
const { sectionMrkdwn } = require("../blocks/claimChannelAnalysis");

const CAROUSEL_TITLE = "Claim images";
const BODY_MAX = 200;
const TITLE_MAX = 150;
const SUBTITLE_MAX = 150;

function truncate(text, max) {
  const body = String(text || "").trim();
  if (body.length <= max) return body;
  return `${body.slice(0, max - 1)}…`;
}

function sourceLabel(source) {
  if (source === "local") return "Local";
  if (source === "feed") return "Chatter feed";
  return "Record file";
}

function buildCarouselCard(image, index) {
  const card = {
    type: "card",
    block_id: `claim-image-${index}`,
    title: {
      type: "mrkdwn",
      text: truncate(image.title || `Image ${index + 1}`, TITLE_MAX),
      verbatim: false,
    },
    subtitle: {
      type: "mrkdwn",
      text: truncate(sourceLabel(image.source), SUBTITLE_MAX),
      verbatim: false,
    },
    hero_image: {
      type: "image",
      image_url: image.imageUrl,
      alt_text: truncate(image.title || "Claim image", 150),
    },
  };

  const bodyParts = [];
  if (image.body && image.source === "local") {
    bodyParts.push(truncate(image.body, 120));
  } else if (image.feedTitle && image.source === "feed") {
    bodyParts.push(truncate(image.feedTitle, 120));
  }
  if (image.salesforceUrl) {
    bodyParts.push(`<${image.salesforceUrl}|Open in Salesforce>`);
  }
  if (bodyParts.length) {
    card.body = {
      type: "mrkdwn",
      text: truncate(bodyParts.join("\n"), BODY_MAX),
      verbatim: false,
    };
  }

  return card;
}

function buildClaimFeedCarouselBlock(images) {
  if (!images?.length) return null;
  return {
    type: "carousel",
    block_id: "claim_images_carousel",
    elements: images.slice(0, MAX_IMAGES).map((image, index) => buildCarouselCard(image, index)),
  };
}

function buildEmptyClaimFeedImagesSection({ reason = "none" } = {}) {
  const messages = {
    none: "_No local claim images configured._",
    upload_failed:
      "_Could not publish claim images._ Start ngrok (`npm run tunnel`), set `CLAIMS_FRAUD_PUBLIC_BASE_URL` to the ngrok HTTPS URL, restart the agent, or reinstall the app with `files:write`.",
  };
  return sectionMrkdwn(
    `:frame_with_picture: *${CAROUSEL_TITLE}*\n${messages[reason] || messages.none}`
  );
}

/** files.uploadV2 nests the file object under files[0].files[0]. */
function extractUploadedFile(upload) {
  const top = upload?.files?.[0];
  if (top?.files?.length) return top.files[0];
  if (top?.id) return top;
  return upload?.file || null;
}

function buildStaticClaimImageUrl(imageMeta, publicBaseUrl = config.publicBaseUrl) {
  if (!publicBaseUrl || !imageMeta?.filename) return null;
  const base = String(publicBaseUrl).replace(/\/$/, "");
  const folder = imageMeta.claimFolder || SHARED_DEMO_FOLDER;
  return `${base}/demo/claim-images/${encodeURIComponent(folder)}/${encodeURIComponent(imageMeta.filename)}`;
}

async function uploadImageForCarousel(client, { buffer, filename, mimeType, logger }) {
  const upload = await client.files.uploadV2({
    file: buffer,
    filename,
    alt_text: filename,
  });

  const file = extractUploadedFile(upload);
  if (!file?.id) {
    throw new Error("Slack upload returned no file id");
  }

  if (file.permalink_public) return file.permalink_public;

  try {
    const shared = await client.files.sharedPublicURL({ file: file.id });
    const publicUrl = shared?.file?.permalink_public;
    if (publicUrl) return publicUrl;
  } catch (err) {
    logger?.warn?.(
      `files.sharedPublicURL failed for ${filename}: ${err.data?.error || err.message}`
    );
  }

  if (file.url_private) {
    logger?.warn?.(`Using private Slack URL for carousel image ${filename} — may not render in carousel`);
    return file.url_private;
  }

  throw new Error("Could not resolve Slack image URL for carousel");
}

async function downloadCarouselImage(image) {
  if (image.source === "local") {
    return readLocalClaimImage(image);
  }
  return downloadClaimImage(image);
}

function shouldUsePublicStaticUrl(image) {
  return Boolean(config.publicBaseUrl && image?.source === "local" && image?.filename);
}

async function resolveCarouselImageUrl(client, image, downloaded, { logger } = {}) {
  if (shouldUsePublicStaticUrl(image)) {
    const staticUrl = buildStaticClaimImageUrl(image);
    if (staticUrl) {
      logger?.info?.(
        `Using public static URL for carousel image ${image.filename || image.title}: ${staticUrl}`
      );
      return staticUrl;
    }
  }

  try {
    const filename =
      downloaded.name.includes(".") ? downloaded.name : `${downloaded.name}.jpg`;
    return await uploadImageForCarousel(client, {
      buffer: downloaded.buffer,
      filename,
      mimeType: downloaded.mimeType,
      logger,
    });
  } catch (uploadErr) {
    const staticUrl = buildStaticClaimImageUrl(image);
    if (staticUrl) {
      logger?.warn?.(
        `Slack upload failed for ${image.filename || image.title}, using static URL: ${uploadErr.message}`
      );
      return staticUrl;
    }
    throw uploadErr;
  }
}

async function hydrateCarouselImages(client, images, { recordUrl, logger } = {}) {
  const hydrated = [];

  for (const image of images) {
    try {
      let imageUrl;
      if (shouldUsePublicStaticUrl(image)) {
        imageUrl = buildStaticClaimImageUrl(image);
        if (!imageUrl) {
          throw new Error("Could not build public URL for local carousel image");
        }
        logger?.info?.(
          `Carousel image ${image.filename || image.title} → ${imageUrl} (public static, skipping Slack upload)`
        );
      } else {
        const downloaded = await downloadCarouselImage(image);
        imageUrl = await resolveCarouselImageUrl(client, image, downloaded, { logger });
      }
      hydrated.push({
        ...image,
        imageUrl,
        salesforceUrl: image.source === "local" ? null : recordUrl,
      });
    } catch (err) {
      const imageRef = image.title || image.contentVersionId || image.filename || "image";
      const detail = err.data?.error === "missing_scope" ? `${err.message} (needs files:write)` : err.message;
      logger?.warn?.(`Skipping carousel image ${imageRef}: ${detail}`);
    }
  }

  return hydrated;
}

/**
 * Load claim images (local by default), resolve public carousel URLs, and build carousel blocks.
 * Local demo images use CLAIMS_FRAUD_PUBLIC_BASE_URL (e.g. ngrok) when set; otherwise Slack upload.
 */
async function buildClaimFeedImageCarouselPart({
  client,
  claimNumber,
  salesforceId,
  includeEmptyState = true,
  localOnly = true,
  logger,
}) {
  const blocks = [];
  const texts = [];
  const resolvedClaimNumber = String(claimNumber || "").trim();

  let images = [];
  let recordUrl = null;

  if (localOnly) {
    images = getLocalClaimFeedImages(resolvedClaimNumber, { limit: MAX_IMAGES });
  } else {
    const { fetchClaimFeedImages } = require("../salesforce/claimImages");
    const result = await fetchClaimFeedImages({ claimNumber, salesforceId });
    recordUrl = result.recordUrl;
    images = result.images || [];

    if (!images.length) {
      const localImages = getLocalClaimFeedImages(result.claimNumber || resolvedClaimNumber, {
        limit: MAX_IMAGES,
      });
      if (localImages.length) images = localImages;
    }

    if (!images.length) {
      if (!result.ok && result.reason !== "salesforce_disabled") {
        if (!includeEmptyState) return null;
        blocks.push(
          sectionMrkdwn(
            `:warning: *${CAROUSEL_TITLE}*\nCould not load Salesforce images${result.error ? `: ${result.error}` : "."}`
          )
        );
        return { text: `${CAROUSEL_TITLE} unavailable`, blocks: blocks.filter(Boolean) };
      }

      if (!includeEmptyState) return null;
      blocks.push(buildEmptyClaimFeedImagesSection());
      return {
        text: `${CAROUSEL_TITLE}: none yet`,
        blocks: blocks.filter(Boolean),
      };
    }
  }

  if (!images.length) {
    if (!includeEmptyState) return null;
    blocks.push(buildEmptyClaimFeedImagesSection());
    return {
      text: `${CAROUSEL_TITLE}: none configured`,
      blocks: blocks.filter(Boolean),
    };
  }

  const hydrated = await hydrateCarouselImages(client, images, {
    recordUrl,
    logger,
  });

  if (!hydrated.length) {
    if (!includeEmptyState) return null;
    blocks.push(buildEmptyClaimFeedImagesSection({ reason: "upload_failed" }));
    return {
      text: `${CAROUSEL_TITLE}: upload failed`,
      blocks: blocks.filter(Boolean),
    };
  }

  blocks.push(
    sectionMrkdwn(
      `*${CAROUSEL_TITLE}* · ${hydrated.length} image${hydrated.length === 1 ? "" : "s"}`
    )
  );
  const carousel = buildClaimFeedCarouselBlock(hydrated);
  if (carousel) blocks.push(carousel);

  texts.push(`${hydrated.length} claim image${hydrated.length === 1 ? "" : "s"}`);
  return {
    text: texts.join(" · "),
    blocks: blocks.filter(Boolean),
    fromLocal: localOnly || images.every((img) => img.source === "local"),
  };
}

module.exports = {
  CAROUSEL_TITLE,
  buildClaimFeedCarouselBlock,
  buildClaimFeedImageCarouselPart,
  buildEmptyClaimFeedImagesSection,
  buildStaticClaimImageUrl,
  downloadCarouselImage,
  extractUploadedFile,
  hydrateCarouselImages,
  shouldUsePublicStaticUrl,
  uploadImageForCarousel,
};
