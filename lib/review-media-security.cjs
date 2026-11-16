"use strict";

function getOwnedReviewMediaPaths(photos, userId, supabaseUrl) {
  if (!Array.isArray(photos) || typeof userId !== "string" || !userId || typeof supabaseUrl !== "string") {
    return [];
  }

  let expectedOrigin;
  try {
    expectedOrigin = new URL(supabaseUrl).origin;
  } catch {
    return [];
  }

  const marker = "/storage/v1/object/public/products-media/";
  const paths = new Set();

  for (const value of photos) {
    if (typeof value !== "string") continue;
    try {
      const mediaUrl = new URL(value);
      if (mediaUrl.origin !== expectedOrigin) continue;
      const pathname = decodeURIComponent(mediaUrl.pathname);
      if (!pathname.startsWith(marker)) continue;
      const path = pathname.slice(marker.length);
      const segments = path.split("/");
      if (
        segments.length < 3 ||
        segments[0] !== "reviews" ||
        segments[1] !== userId ||
        segments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("\\\\"))
      ) continue;
      paths.add(path);
    } catch {
      // URLs externas, inválidas ou malformadas nunca autorizam remoção.
    }
  }

  return [...paths];
}

module.exports = { getOwnedReviewMediaPaths };
