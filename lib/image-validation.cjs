const SIGNATURES = {
  "image/jpeg": (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (b) => b.length >= 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP",
  "image/gif": (b) => b.length >= 6 && ["GIF87a", "GIF89a"].includes(b.toString("ascii", 0, 6)),
};

function isValidImageBase64(value, mimeType, allowedMimeTypes, maxBytes) {
  if (typeof value !== "string" || value.length === 0 || value.length % 4 !== 0) return false;
  if (!Array.isArray(allowedMimeTypes) || !allowedMimeTypes.includes(mimeType)) return false;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) return false;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;

  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.length > maxBytes || bytes.toString("base64") !== value) return false;
  const matchesSignature = SIGNATURES[mimeType];
  return typeof matchesSignature === "function" && matchesSignature(bytes);
}

module.exports = { isValidImageBase64 };
