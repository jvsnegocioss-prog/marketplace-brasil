const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const helper = fs.readFileSync(path.join(__dirname, "../lib/mercado-pago-webhook-helpers.ts"), "utf8");
const webhook = fs.readFileSync(path.join(__dirname, "../app/api/mercadopago/webhook/route.ts"), "utf8");

test("assinatura HMAC usa manifesto normalizado e SHA-256", () => {
  assert.match(helper, /dataId\.toLowerCase\(\)/);
  assert.match(helper, /id:\$\{normalizedDataId\};request-id:\$\{requestId\};ts:\$\{timestamp\};/);
  assert.match(helper, /createHmac\("sha256", secret\)/);
});

test("comparação de assinatura usa comparação em tempo constante", () => {
  assert.match(helper, /timingSafeEqual\(expectedBuffer, receivedBuffer\)/);
  assert.match(helper, /\^\[a-f0-9\]\{64\}\$\/i/);
});

test("somente estados processados aprovam e estados financeiros posteriores exigem conciliação", () => {
  assert.match(helper, /status === "processed"\) return "approve"/);
  assert.match(helper, /status === "canceled" \|\| status === "failed"\) return "cancel"/);
  assert.match(helper, /status === "refunded" \|\| status === "charged_back"\) return "reconcile"/);
});

test("aprovação exige BRL, valores exatos e todas as transações processadas", () => {
  assert.match(helper, /currency_id !== "BRL"/);
  assert.match(helper, /orderAmountCents !== expectedCents/);
  assert.match(helper, /paidAmountCents !== expectedCents/);
  assert.match(helper, /paymentsAreProcessed/);
});

test("webhook valida assinatura antes de consultar a Orders API", () => {
  const signatureCheck = webhook.indexOf("if (!signatureMatches)");
  const apiFetch = webhook.indexOf("https://api.mercadopago.com/v1/orders/");
  assert.ok(signatureCheck >= 0 && apiFetch > signatureCheck);
});

test("webhook exige vínculo de pedido e evita alterar pedidos já finalizados", () => {
  assert.match(webhook, /external_reference/);
  assert.match(webhook, /storeOrder\.mercado_pago_order_id/);
  assert.match(webhook, /currentStoreStatus !== "aguardando"/);
});

test("reembolso e chargeback não restauram estoque automaticamente", () => {
  const reconcile = webhook.indexOf('if (webhookAction === "reconcile")');
  const cancel = webhook.indexOf('if (webhookAction === "cancel")');
  assert.ok(reconcile >= 0 && cancel > reconcile);
  assert.match(webhook, /reconciliation_required/);
});
