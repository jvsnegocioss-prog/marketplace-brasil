const MIME_RULES = {
  "image/jpeg": { kind: "image", extension: "jpg" },
  "image/png": { kind: "image", extension: "png" },
  "image/webp": { kind: "image", extension: "webp" },
  "image/gif": { kind: "image", extension: "gif" },
  "video/mp4": { kind: "video", extension: "mp4" },
  "video/webm": { kind: "video", extension: "webm" },
  "video/quicktime": { kind: "video", extension: "mov" },
};

function hasSignature(bytes, mimeType) {
  const starts = (...values) => values.every((value, index) => bytes[index] === value);
  if (mimeType === "image/jpeg") return bytes.length >= 3 && starts(0xff, 0xd8, 0xff);
  if (mimeType === "image/png") return bytes.length >= 8 && starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  if (mimeType === "image/webp") return bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP";
  if (mimeType === "image/gif") {
    const header = String.fromCharCode(...bytes.subarray(0, 6));
    return bytes.length >= 6 && (header === "GIF87a" || header === "GIF89a");
  }
  if (mimeType === "video/webm") return bytes.length >= 4 && starts(0x1a, 0x45, 0xdf, 0xa3);
  if (mimeType === "video/mp4") return bytes.length >= 12 && String.fromCharCode(...bytes.subarray(4, 8)) === "ftyp" && String.fromCharCode(...bytes.subarray(8, 12)) !== "qt  ";
  if (mimeType === "video/quicktime") return bytes.length >= 12 && String.fromCharCode(...bytes.subarray(4, 8)) === "ftyp" && String.fromCharCode(...bytes.subarray(8, 12)) === "qt  ";
  return false;
}

function inspectMediaBytes(bytes, mimeType, maxBytes) {
  if (!(bytes instanceof Uint8Array) || !Number.isSafeInteger(maxBytes) || maxBytes <= 0) return null;
  const rule = MIME_RULES[mimeType];
  if (!rule || bytes.length === 0 || bytes.length > maxBytes || !hasSignature(bytes, mimeType)) return null;
  return { kind: rule.kind, extension: rule.extension };
}

module.exports = { inspectMediaBytes };
