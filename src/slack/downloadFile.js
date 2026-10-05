const IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function isImageFile(file, options = {}) {
  const mime = String(file?.mimetype || file?.filetype || "").toLowerCase();
  if (mime.startsWith("image/") || IMAGE_MIMES.has(mime)) return true;
  const name = String(file?.name || file?.title || "").toLowerCase();
  if (/\.(jpe?g|png|webp|gif|heic|heif)$/.test(name)) return true;
  if (options.fileShare && !mime && name) return true;
  return false;
}

async function downloadSlackFile(client, file, options = {}) {
  const maxBytes = options.maxBytes || 8 * 1024 * 1024;
  const url = file?.url_private || file?.url_private_download;
  if (!url) throw new Error("Slack file has no private download URL");

  const token = options.token || client?.token;
  if (!token) throw new Error("Bot token required to download Slack files");

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Slack file download failed: ${res.status}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > maxBytes) {
    throw new Error(`Image exceeds ${maxBytes} byte limit`);
  }

  return {
    buffer,
    mimetype: file.mimetype || "image/jpeg",
    name: file.name || file.title || "image",
    size: buffer.length,
  };
}

module.exports = {
  isImageFile,
  downloadSlackFile,
  IMAGE_MIMES,
};
