const test = require("node:test");
const assert = require("node:assert/strict");
const { inspectMediaBytes } = require("../lib/media-validation.cjs");

const samples = [
  ["image/jpeg", [0xff, 0xd8, 0xff, 0xe0], "image", "jpg"],
  ["image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "image", "png"],
  ["image/webp", [...Buffer.from("RIFFxxxxWEBP")], "image", "webp"],
  ["image/gif", [...Buffer.from("GIF89a")], "image", "gif"],
  ["video/mp4", [...Buffer.from("0000ftypisom")], "video", "mp4"],
  ["video/webm", [0x1a, 0x45, 0xdf, 0xa3, 0x00], "video", "webm"],
  ["video/quicktime", [...Buffer.from("0000ftypqt  ")], "video", "mov"],
];

test("accepts matching signatures and returns safe canonical extensions", () => {
  for (const [mime, bytes, kind, extension] of samples) {
    assert.deepEqual(inspectMediaBytes(Uint8Array.from(bytes), mime, 1024), { kind, extension });
  }
});

test("rejects MIME spoofing, unsupported formats and oversized files", () => {
  const jpeg = Uint8Array.from(samples[0][1]);
  assert.equal(inspectMediaBytes(jpeg, "image/png", 1024), null);
  assert.equal(inspectMediaBytes(jpeg, "image/svg+xml", 1024), null);
  assert.equal(inspectMediaBytes(jpeg, "image/jpeg", 2), null);
});

test("rejects malformed video containers and empty files", () => {
  assert.equal(inspectMediaBytes(Uint8Array.from([1, 2, 3]), "video/mp4", 1024), null);
  assert.equal(inspectMediaBytes(new Uint8Array(), "image/png", 1024), null);
});
