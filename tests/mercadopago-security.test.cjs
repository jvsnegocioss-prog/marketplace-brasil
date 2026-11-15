const test = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const {
  isValidWebhookTimestamp,
  verifyMercadoPagoSignature,
  amountToCents,
  isProcessedOrderPaymentMatching,
} = require("../lib/mercadopago-security.cjs");

test("aceita assinatura HMAC válida e normaliza data.id", () => {
  const secret = "test-secret";
  const dataId = "AbC123";
  const requestId = "request-123";
  const ts = "1794700000000";
  const manifest = `id:abc123;request-id:request-123;ts:${ts};`;
  const signature = createHmac("sha256", secret).update(manifest).digest("hex");
  assert.equal(verifyMercadoPagoSignature(secret, dataId, requestId, ts, signature), true);
});

test("rejeita assinatura inválida, incompleta ou malformada", () => {
  assert.equal(verifyMercadoPagoSignature("secret", "id", "req", "123", "bad"), false);
  assert.equal(verifyMercadoPagoSignature("secret", "id", "req", "123", "a".repeat(64)), false);
});

test("aceita timestamp antigo assinado para reentrega legítima", () => {
  assert.equal(isValidWebhookTimestamp("1700000000", 1794700000000), true);
});

test("rejeita timestamp muito futuro e timestamp inseguro", () => {
  assert.equal(isValidWebhookTimestamp("1794700600000", 1794700000000), false);
  assert.equal(isValidWebhookTimestamp("9007199254740992", 1794700000000), false);
  assert.equal(isValidWebhookTimestamp("abc", 1794700000000), false);
});

test("converte valores monetários para centavos com validação", () => {
  assert.equal(amountToCents("123.45"), 12345);
  assert.equal(amountToCents(10), 1000);
  assert.equal(amountToCents(-1), null);
  assert.equal(amountToCents("invalid"), null);
  assert.equal(amountToCents(null), null);
});

test("aceita somente pedido pago integralmente em BRL", () => {
  const order = {
    currency_id: "BRL",
    total_amount: "129.90",
    total_paid_amount: "129.90",
    transactions: { payments: [{ status: "processed" }] },
  };
  assert.equal(isProcessedOrderPaymentMatching("129.90", order), true);
  assert.equal(isProcessedOrderPaymentMatching("130.00", order), false);
  assert.equal(isProcessedOrderPaymentMatching("129.90", { ...order, currency_id: "USD" }), false);
  assert.equal(isProcessedOrderPaymentMatching("129.90", { ...order, total_paid_amount: "100.00" }), false);
  assert.equal(isProcessedOrderPaymentMatching("129.90", { ...order, transactions: { payments: [{ status: "pending" }] } }), false);
  assert.equal(isProcessedOrderPaymentMatching("129.90", { ...order, transactions: { payments: [] } }), false);
});
