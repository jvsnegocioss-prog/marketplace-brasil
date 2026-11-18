const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const page = fs.readFileSync(path.join(__dirname, "..", "app", "page.tsx"), "utf8");
const checkoutRoute = fs.readFileSync(path.join(__dirname, "..", "app", "api", "checkout", "route.ts"), "utf8");

test("checkout vincula a tentativa à identidade da sessão", () => {
  assert.match(page, /resolveCheckoutAttempt\(savedAttempt, checkoutFingerprint, sessionData\.session\?\.user\?\.id \|\| null/);
});

test("checkout não gera nova chave quando a tentativa salva tem dados diferentes", () => {
  assert.match(page, /attemptDecision\.reason === "payload_mismatch"/);
  assert.match(page, /attemptDecision\.reason === "identity_mismatch"/);
  assert.doesNotMatch(page, /if \(response\.status === 409\)\s*\{\s*localStorage\.removeItem/);
});

test("chave só é removida após rejeição definitiva e cancelamento confirmado", () => {
  assert.match(page, /result\.code === "attempt_rejected"[\s\S]*?localStorage\.removeItem/);
  assert.match(checkoutRoute, /attemptCheckoutCancellation\(\(\) => cancelOrder\(/);
  assert.match(checkoutRoute, /cancellation\.confirmed[\s\S]*?code: "attempt_rejected"/);
  assert.doesNotMatch(checkoutRoute, /await cancelOrder\([^;]+\);\s*createdOrderId = null;/);
});

test("pedido já encerrado não é tratado como autorização automática para nova compra", () => {
  assert.match(checkoutRoute, /code: "attempt_closed"/);
  assert.match(page, /result\.code === "attempt_rejected"/);
});