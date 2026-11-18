"use strict";

// Best-effort per-process throttling. This is defense in depth only:
// serverless instances/cold starts do not share this Map. Use a persistent
// shared store for a hard cross-instance quota when one is approved/configured.
const buckets = new Map();
const MAX_BUCKETS = 10_000;

function consumeLocalRateLimit(key, { limit, windowMs, now = Date.now() }) {
  if (typeof key !== "string" || !key || !Number.isSafeInteger(limit) || limit < 1 ||
      !Number.isSafeInteger(windowMs) || windowMs < 1 || !Number.isFinite(now)) {
    throw new TypeError("Invalid rate limit arguments");
  }

  let bucket = buckets.get(key);
  if (!bucket || now - bucket.startedAt >= windowMs || now < bucket.startedAt) {
    if (buckets.size >= MAX_BUCKETS) {
      for (const [existingKey, value] of buckets) {
        if (now - value.startedAt >= value.windowMs || now < value.startedAt) buckets.delete(existingKey);
      }
      while (buckets.size >= MAX_BUCKETS) buckets.delete(buckets.keys().next().value);
    }
    bucket = { startedAt: now, count: 0, windowMs };
    buckets.set(key, bucket);
  }

  bucket.count += 1;
  const allowed = bucket.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - bucket.count),
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((bucket.startedAt + windowMs - now) / 1000)),
  };
}

function resetLocalRateLimitsForTests() {
  buckets.clear();
}

module.exports = { consumeLocalRateLimit, resetLocalRateLimitsForTests };
