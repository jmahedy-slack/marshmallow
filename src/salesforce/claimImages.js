const config = require("../config");
const {
  sfJson,
  getInstanceUrl,
  recordUrl,
  escapeSoqlString,
  downloadContentVersion,
} = require("./client");
const { fetchClaimFromSalesforce } = require("./claim");
const { isImageFile, IMAGE_MIMES } = require("../slack/downloadFile");

const MAX_IMAGES = 10;
const IMAGE_FILE_TYPES = new Set(["PNG", "JPG", "JPEG", "GIF", "WEBP", "BMP", "TIFF"]);

const EXT_MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  tiff: "image/tiff",
};

function mimeForImage({ fileExtension, fileType, title }) {
  const ext = String(fileExtension || "").toLowerCase();
  if (EXT_MIME[ext]) return EXT_MIME[ext];
  const ft = String(fileType || "").toUpperCase();
  if (ft === "PNG") return "image/png";
  if (ft === "JPG" || ft === "JPEG") return "image/jpeg";
  if (ft === "GIF") return "image/gif";
  if (ft === "WEBP") return "image/webp";
  const name = String(title || "").toLowerCase();
  const match = name.match(/\.(jpe?g|png|gif|webp|bmp|tiff)$/);
  if (match && EXT_MIME[match[1]]) return EXT_MIME[match[1]];
  return "image/jpeg";
}

function isSalesforceImageMeta(meta) {
  const fileType = String(meta?.fileType || meta?.FileType || "").toUpperCase();
  if (IMAGE_FILE_TYPES.has(fileType)) return true;
  const ext = String(meta?.fileExtension || meta?.FileExtension || "").toLowerCase();
  if (EXT_MIME[ext]) return true;
  const title = meta?.title || meta?.Title || "";
  return isImageFile({ name: title, mimetype: mimeForImage({ fileExtension: ext, fileType, title }) });
}

async function resolveClaimSalesforceId(claimNumber, salesforceId) {
  if (salesforceId) return salesforceId;
  const sf = await fetchClaimFromSalesforce(claimNumber);
  return sf.linked ? sf.record?.salesforceId : null;
}

async function queryContentDocumentLinks(linkedEntityId) {
  const query = [
    "SELECT ContentDocumentId, LinkedEntityId, ShareType, SystemModstamp",
    "FROM ContentDocumentLink",
    `WHERE LinkedEntityId = '${escapeSoqlString(linkedEntityId)}'`,
    "ORDER BY SystemModstamp DESC",
    `LIMIT ${MAX_IMAGES * 2}`,
  ].join(" ");
  const result = await sfJson(["data", "query", "--query", query]);
  return result.records || [];
}

async function queryFeedItems(parentId) {
  const query = [
    "SELECT Id, Title, Body, Type, CreatedDate, HasContent, HasLink",
    "FROM FeedItem",
    `WHERE ParentId = '${escapeSoqlString(parentId)}'`,
    "ORDER BY CreatedDate DESC",
    "LIMIT 50",
  ].join(" ");
  const result = await sfJson(["data", "query", "--query", query]);
  return result.records || [];
}

async function queryFeedAttachments(feedEntityId) {
  const query = [
    "SELECT Id, FeedEntityId, Type, Title, RecordId",
    "FROM FeedAttachment",
    `WHERE FeedEntityId = '${escapeSoqlString(feedEntityId)}'`,
    "AND Type IN ('Content', 'File')",
    "LIMIT 10",
  ].join(" ");
  const result = await sfJson(["data", "query", "--query", query]);
  return result.records || [];
}

async function queryLatestContentVersions(contentDocumentIds) {
  const ids = [...new Set(contentDocumentIds.filter(Boolean))];
  if (!ids.length) return [];

  const quoted = ids.map((id) => `'${escapeSoqlString(id)}'`).join(", ");
  const query = [
    "SELECT Id, Title, FileExtension, ContentDocumentId, ContentSize, FileType, CreatedDate, VersionNumber",
    "FROM ContentVersion",
    `WHERE ContentDocumentId IN (${quoted}) AND IsLatest = true`,
    "ORDER BY CreatedDate DESC",
    `LIMIT ${MAX_IMAGES * 2}`,
  ].join(" ");
  const result = await sfJson(["data", "query", "--query", query]);
  return result.records || [];
}

function buildImageRecord(version, context = {}) {
  const title = version.Title || "Claim image";
  const fileExtension = version.FileExtension || "";
  const fileType = version.FileType || "";
  return {
    contentDocumentId: version.ContentDocumentId,
    contentVersionId: version.Id,
    title,
    fileExtension,
    fileType,
    mimeType: mimeForImage({ fileExtension, fileType, title }),
    contentSize: version.ContentSize,
    createdDate: version.CreatedDate,
    source: context.source || "record",
    feedItemId: context.feedItemId || null,
    feedTitle: context.feedTitle || null,
  };
}

async function collectFeedContentDocumentIds(parentId) {
  const feedItems = await queryFeedItems(parentId);
  const docIds = [];
  const contexts = new Map();

  for (const item of feedItems) {
    const attachments = await queryFeedAttachments(item.Id);
    for (const attachment of attachments) {
      const docId = attachment.RecordId;
      if (!docId) continue;
      docIds.push(docId);
      contexts.set(docId, {
        source: "feed",
        feedItemId: item.Id,
        feedTitle: attachment.Title || item.Title || item.Body?.slice(0, 80) || "Feed post",
      });
    }
  }

  return { docIds, contexts };
}

/**
 * List image metadata attached to a Claim__c record or its Chatter feed.
 */
async function fetchClaimFeedImages({ claimNumber, salesforceId, limit = MAX_IMAGES } = {}) {
  const claimId = String(claimNumber || "").trim().toUpperCase();
  if (!claimId) {
    return { ok: false, reason: "no_claim", images: [] };
  }

  if (!config.salesforceEnabled) {
    return {
      ok: false,
      reason: "salesforce_disabled",
      claimNumber: claimId,
      images: [],
    };
  }

  try {
    const recordId = await resolveClaimSalesforceId(claimId, salesforceId);
    if (!recordId) {
      return { ok: false, reason: "claim_not_found", claimNumber: claimId, images: [] };
    }

    const [links, feedDocs] = await Promise.all([
      queryContentDocumentLinks(recordId),
      collectFeedContentDocumentIds(recordId),
    ]);

    const docContexts = new Map(feedDocs.contexts);
    for (const link of links) {
      if (!link.ContentDocumentId) continue;
      if (!docContexts.has(link.ContentDocumentId)) {
        docContexts.set(link.ContentDocumentId, { source: "record" });
      }
    }

    const allDocIds = [
      ...links.map((link) => link.ContentDocumentId),
      ...feedDocs.docIds,
    ].filter(Boolean);

    if (!allDocIds.length) {
      const instanceUrl = await getInstanceUrl();
      return {
        ok: true,
        claimNumber: claimId,
        salesforceId: recordId,
        recordUrl: recordUrl(instanceUrl, config.salesforceClaimObject, recordId),
        images: [],
        empty: true,
      };
    }

    const versions = await queryLatestContentVersions(allDocIds);
    const images = [];

    for (const version of versions) {
      if (!isSalesforceImageMeta(version)) continue;
      const context = docContexts.get(version.ContentDocumentId) || { source: "record" };
      images.push(buildImageRecord(version, context));
      if (images.length >= limit) break;
    }

    const instanceUrl = await getInstanceUrl();
    return {
      ok: true,
      claimNumber: claimId,
      salesforceId: recordId,
      recordUrl: recordUrl(instanceUrl, config.salesforceClaimObject, recordId),
      images,
      empty: images.length === 0,
    };
  } catch (err) {
    return {
      ok: false,
      reason: "query_failed",
      claimNumber: claimId,
      error: err.message,
      images: [],
    };
  }
}

async function downloadClaimImage(imageMeta, options = {}) {
  if (!imageMeta?.contentVersionId) {
    throw new Error("Missing ContentVersion id");
  }
  const buffer = await downloadContentVersion(imageMeta.contentVersionId, options);
  return {
    buffer,
    mimeType: imageMeta.mimeType || mimeForImage(imageMeta),
    name: imageMeta.title || `claim-image.${imageMeta.fileExtension || "jpg"}`,
  };
}

module.exports = {
  MAX_IMAGES,
  IMAGE_MIMES,
  fetchClaimFeedImages,
  downloadClaimImage,
  mimeForImage,
  isSalesforceImageMeta,
};
