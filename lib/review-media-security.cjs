"use strict";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const reviewMediaPath = new RegExp("^reviews/(" + UUID + ")/(" + UUID + ")\\.(jpg|png|webp|gif|mp4|webm|mov)$", "i");

function isReviewMediaPath(value) {
  return typeof value === "string" && value.length <= 256 && reviewMediaPath.test(value);
}

function getOwnedReviewMediaPaths(photos, userId) {
  if (!Array.isArray(photos) || typeof userId !== "string" || !userId) return [];
  return [...new Set(photos.filter((value) => {
    if (!isReviewMediaPath(value)) return false;
    return value.split("/")[1] === userId;
  }))];
}

module.exports = { getOwnedReviewMediaPaths, isReviewMediaPath };
