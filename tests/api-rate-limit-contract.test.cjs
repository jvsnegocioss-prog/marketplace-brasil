const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("public coupon validation uses only platform client IP and returns 429 with Retry-After", () => {
  const source = read("app/api/coupons/validate/route.ts");
  assert.match(source, /headers\.get\("x-real-ip"\)/);
  assert.doesNotMatch(source, /headers\.get\("x-forwarded-for"\)/);
  assert.match(source, /consumeLocalRateLimit\(\`coupon:/);
  assert.match(source, /limit: 10, windowMs: 15 \* 60 \* 1000/);
  assert.match(source, /status: 429/);
  assert.match(source, /"Retry-After"/);
});

for (const route of ["ai-product", "ai-campaign"]) {
  test(`admin ${route} API requires verified admin identity and throttles by user ID`, () => {
    const source = read(`app/api/admin/${route}/route.ts`);
    assert.match(source, /auth\.getUser\(token\)/);
    assert.match(source, /rpc\("is_marketplace_admin"\)/);
    assert.match(source, /consumeLocalRateLimit\(\`admin-ai:/);
    assert.match(source, /limit: 5, windowMs: 60 \* 1000/);
    assert.match(source, /status: 429/);
    assert.match(source, /"Retry-After"/);
  });
}
