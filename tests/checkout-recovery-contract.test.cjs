const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const route = fs.readFileSync("app/api/checkout/recovery/route.ts", "utf8");
const checkout = fs.readFileSync("app/api/checkout/route.ts", "utf8");
const migration = fs.readFileSync("supabase/migrations/20261118120000_add_secure_checkout_recovery.sql", "utf8");
const page = fs.readFileSync("app/page.tsx", "utf8");

test("recovery endpoint requires account ownership or a separate recovery token", () => {
  assert.match(route, /customer_user_id/);
  assert.match(route, /checkout_recovery_tokens/);
  assert.match(route, /hashRecoveryToken/);
  assert.doesNotMatch(route, /customer_email|customer_phone|delivery_address/i);
});

test("recovery endpoint is GET-only and disables caching", () => {
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export async function POST|\.rpc\s*\(/);
  assert.match(route, /Cache-Control.*no-store/);
});

test("checkout binds only a hash of a separate recovery token", () => {
  assert.match(checkout, /X-Checkout-Recovery-Token/);
  assert.match(checkout, /p_checkout_recovery_token_hash/);
  assert.match(checkout, /hashRecoveryToken/);
});

test("client persists the token and checks recovery before retrying checkout", () => {
  assert.match(page, /recoveryToken/);
  assert.match(page, /\/api\/checkout\/recovery/);
  assert.match(page, /X-Checkout-Recovery-Token/);
});

test("migration keeps token table private and binds token atomically", () => {
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(migration, /create_store_order_with_recovery_token/i);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /REVOKE ALL/i);
  assert.match(migration, /GRANT EXECUTE.*service_role/is);
});
