/**
 * Smoke-test Salesforce claim feed image discovery, local fallback, and carousel block shape.
 * Usage:
 *   node scripts/test_claim_feed_carousel.js [CLM-0025]
 *   node scripts/test_claim_feed_carousel.js CLM-0025 --local
 *   node scripts/test_claim_feed_carousel.js CLM-0025 --mock
 */
const { fetchClaimFeedImages } = require("../src/salesforce/claimImages");
const { getLocalClaimFeedImages } = require("../src/data/localClaimImages");
const {
  buildClaimFeedCarouselBlock,
  buildEmptyClaimFeedImagesSection,
} = require("../src/slack/claimImageCarousel");

const claimNumber = process.argv.find((arg) => !arg.startsWith("-") && arg !== process.argv[0] && arg !== process.argv[1]) || "CLM-0025";
const useMock = process.argv.includes("--mock");
const localOnly = process.argv.includes("--local");

async function main() {
  if (useMock) {
    const mockImages = [
      {
        title: "Front bumper damage",
        source: "feed",
        feedTitle: "Uploaded damage photo",
        imageUrl: "https://picsum.photos/400/300?random=1",
      },
      {
        title: "Rear panel",
        source: "record",
        imageUrl: "https://picsum.photos/400/300?random=2",
      },
    ];
    const carousel = buildClaimFeedCarouselBlock(mockImages);
    console.log(JSON.stringify({ mock: true, carousel }, null, 2));
    return;
  }

  if (localOnly) {
    const localImages = getLocalClaimFeedImages(claimNumber);
    console.log(
      JSON.stringify(
        {
          claimNumber,
          source: "local",
          imageCount: localImages.length,
          images: localImages.map((img) => ({
            title: img.title,
            subtitle: img.subtitle,
            body: img.body,
            source: img.source,
            filename: img.filename,
            absolutePath: img.absolutePath,
            mimeType: img.mimeType,
          })),
        },
        null,
        2
      )
    );

    if (localImages.length) {
      console.log("\nCarousel preview (URLs require Slack upload at runtime):");
      console.log(
        JSON.stringify(
          buildClaimFeedCarouselBlock(
            localImages.map((img, index) => ({
              ...img,
              imageUrl: `https://picsum.photos/400/300?random=${index + 10}`,
            }))
          ),
          null,
          2
        )
      );
    }
    return;
  }

  const result = await fetchClaimFeedImages({ claimNumber });
  const localImages = getLocalClaimFeedImages(claimNumber);
  const effectiveImages = result.images?.length ? result.images : localImages;
  const fromLocal = !result.images?.length && localImages.length > 0;

  console.log(
    JSON.stringify(
      {
        claimNumber,
        ok: result.ok,
        empty: result.empty,
        salesforceImageCount: result.images?.length || 0,
        localImageCount: localImages.length,
        effectiveSource: fromLocal ? "local" : result.images?.length ? "salesforce" : "none",
        images: (effectiveImages || []).map((img) => ({
          title: img.title,
          source: img.source,
          contentVersionId: img.contentVersionId,
          filename: img.filename,
          mimeType: img.mimeType,
        })),
        recordUrl: result.recordUrl,
        error: result.error,
      },
      null,
      2
    )
  );

  if (effectiveImages?.length) {
    console.log("\nCarousel preview (URLs require Slack upload at runtime):");
    console.log(
      JSON.stringify(
        buildClaimFeedCarouselBlock(
          effectiveImages.map((img, index) => ({
            ...img,
            imageUrl: `https://picsum.photos/400/300?random=${index + 3}`,
          }))
        ),
        null,
        2
      )
    );
  } else {
    console.log("\nEmpty-state section preview:");
    console.log(
      JSON.stringify(
        buildEmptyClaimFeedImagesSection({
          claimNumber: result.claimNumber || claimNumber,
          recordUrl: result.recordUrl,
        }),
        null,
        2
      )
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
