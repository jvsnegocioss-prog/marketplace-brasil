const test = require("node:test");
const assert = require("node:assert/strict");
const {
  compareSignatures,
  createMercadoPagoWebhookSignature,
  amountToCents,
  classifyMercadoPagoOrderStatus,
  validateProcessedPayment,
} = require("../.test-build/mercado-pago-webhook-helpers.js");

const approvedOrder = {
  currency_id: "BRL",
  total_amount: "129.90",
  total_paid_amount: "129.90",
  transactions: { payments: [{ status: "processed" }] },
};

test("accepts a complete processed BRL order with exact amounts", () => {
  assert.deepEqual(validateProcessedPayment(129.9, approvedOrder), { valid: true });
});

test("rejects wrong currency, order amount, paid amount and incomplete transactions", () => {
  assert.equal(validateProcessedPayment(129.9, { ...approvedOrder, currency_id: "USD" }).reason, "currency_mismatch");
  assert.equal(validateProcessedPayment(129.9, { ...approvedOrder, total_amount: "129.89" }).reason, "order_amount_mismatch");
  assert.equal(validateProcessedPayment(129.9, { ...approvedOrder, total_paid_amount: "100.00" }).reason, "paid_amount_mismatch");
  assert.equal(validateProcessedPayment(129.9, { ...approvedOrder, transactions: { payments: [] } }).reason, "transactions_not_processed");
  assert.equal(validateProcessedPayment(129.9, { ...approvedOrder, transactions: { payments: [{ status: "pending" }] } }).reason, "transactions_not_processed");
  assert.equal(validateProcessedPayment(129.9, { ...approvedOrder, transactions: { payments: [null] } }).reason, "transactions_not_processed");
});

test("rejects invalid, negative and unsafe monetary values", () => {
  assert.equal(amountToCents("not-money"), null);
  assert.equal(amountToCents(-1), null);
  assert.equal(amountToCents(Number.MAX_SAFE_INTEGER), null);
  assert.equal(amountToCents("12.34"), 1234);
});

test("classifies known Mercado Pago Orders statuses conservatively", () => {
  assert.equal(classifyMercadoPagoOrderStatus("processed"), "approve");
  assert.equal(classifyMercadoPagoOrderStatus("canceled"), "cancel");
  assert.equal(classifyMercadoPagoOrderStatus("failed"), "cancel");
  assert.equal(classifyMercadoPagoOrderStatus("refunded"), "reconcile");
  assert.equal(classifyMercadoPagoOrderStatus("charged_back"), "reconcile");
  for (const status of ["created", "processing", "action_required", "unknown", null]) {
    assert.equal(classifyMercadoPagoOrderStatus(status), "ignore");
  }
});

test("compares webhook signatures and rejects malformed or altered hashes", () => {
  const expected = "a".repeat(64);
  assert.equal(compareSignatures(expected, expected), true);
  assert.equal(compareSignatures(expected, "b" + "a".repeat(63)), false);
  assert.equal(compareSignatures(expected, "not-a-signature"), false);
});

test("builds the exact Mercado Pago HMAC manifest and normalizes data.id", () => {
  const secret = "test-webhook-secret";
  const requestId = "req-123";
  const timestamp = "1730000000000";
  const upperId = "ABCDEF123456";
  const lowerId = "abcdef123456";
  const signature = createMercadoPagoWebhookSignature(secret, upperId, requestId, timestamp);
  const expected = createMercadoPagoWebhookSignature(secret, lowerId, requestId, timestamp);

  assert.match(signature, /^[a-f0-9]{64}$/);
  assert.equal(signature, expected);
  assert.equal(
    compareSignatures(signature, createMercadoPagoWebhookSignature(secret, lowerId, requestId, timestamp)),
    true
  );
  assert.notEqual(
    signature,
    createMercadoPagoWebhookSignature(secret, lowerId, "different-request", timestamp)
  );
  assert.notEqual(
    signature,
    createMercadoPagoWebhookSignature(secret, lowerId, requestId, "1730000000001")
  );
});
