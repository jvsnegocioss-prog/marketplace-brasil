const test = require("node:test");
const assert = require("node:assert/strict");
const { consumeLocalRateLimit, resetLocalRateLimitsForTests } = require("../lib/local-rate-limit.cjs");

test("allows requests up to the configured local window limit", () => {
  resetLocalRateLimitsForTests();
  assert.deepEqual(consumeLocalRateLimit("coupon:ip-a", { limit: 2, windowMs: 60_000, now: 1000 }), {
    allowed: true, remaining: 1, retryAfterSeconds: 0,
  });
  assert.deepEqual(consumeLocalRateLimit("coupon:ip-a", { limit: 2, windowMs: 60_000, now: 1100 }), {
    allowed: true, remaining: 0, retryAfterSeconds: 0,
  });
  assert.deepEqual(consumeLocalRateLimit("coupon:ip-a", { limit: 2, windowMs: 60_000, now: 1200 }), {
    allowed: false, remaining: 0, retryAfterSeconds: 60,
  });
});

test("isolates keys and resets after the window", () => {
  resetLocalRateLimitsForTests();
  assert.equal(consumeLocalRateLimit("admin:a", { limit: 1, windowMs: 1000, now: 1000 }).allowed, true);
  assert.equal(consumeLocalRateLimit("admin:b", { limit: 1, windowMs: 1000, now: 1000 }).allowed, true);
  assert.equal(consumeLocalRateLimit("admin:a", { limit: 1, windowMs: 1000, now: 2000 }).allowed, true);
});

test("rejects invalid limiter configuration", () => {
  assert.throws(() => consumeLocalRateLimit("", { limit: 1, windowMs: 1000 }), TypeError);
  assert.throws(() => consumeLocalRateLimit("x", { limit: 0, windowMs: 1000 }), TypeError);
  assert.throws(() => consumeLocalRateLimit("x", { limit: 1, windowMs: 0 }), TypeError);
});
