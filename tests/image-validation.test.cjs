const test = require("node:test");
const assert = require("node:assert/strict");
const { isValidImageBase64 } = require("../lib/image-validation.cjs");

const fixtures = {
  "image/jpeg": Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  "image/png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/webp": Buffer.from("RIFFxxxxWEBP", "ascii"),
  "image/gif": Buffer.from("GIF89a", "ascii"),
};

test("accepts valid base64 signatures for each supported image type", () => {
  for (const [mime, bytes] of Object.entries(fixtures)) {
    assert.equal(isValidImageBase64(bytes.toString("base64"), mime, [mime], 1024), true);
  }
});

test("rejects MIME spoofing when the binary signature does not match", () => {
  const jpeg = fixtures["image/jpeg"].toString("base64");
  assert.equal(isValidImageBase64(jpeg, "image/png", ["image/png"], 1024), false);
});

test("rejects malformed and non-canonical base64", () => {
  assert.equal(isValidImageBase64("not-base64!", "image/jpeg", ["image/jpeg"], 1024), false);
  assert.equal(isValidImageBase64("////", "image/jpeg", ["image/jpeg"], 1024), false);
});

test("rejects images above the byte limit and unsupported MIME types", () => {
  const jpeg = fixtures["image/jpeg"].toString("base64");
  assert.equal(isValidImageBase64(jpeg, "image/jpeg", ["image/jpeg"], 2), false);
  assert.equal(isValidImageBase64(jpeg, "image/bmp", ["image/jpeg"], 1024), false);
});
