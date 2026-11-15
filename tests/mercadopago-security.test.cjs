const test = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const {
  isValidWebhookTimestamp,
  verifyMercadoPagoSignature,
  amountToCents,
  isProcessedOrderPaymentMatching,
  getOrderPaymentDisposition,
  getWebhookNotificationId,
  isWebhookResourceMatch,
  isWebhookNotificationResourceMatch,
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
  // A resposta GET de Orders API usa "currency"; payloads de notificação podem
  // expor "currency_id". Ambos devem ser validados sem aceitar moeda ausente.
  const getOrderShape = { ...order, currency: "BRL" };
  delete getOrderShape.currency_id;
  assert.equal(isProcessedOrderPaymentMatching("129.90", getOrderShape), true);
  assert.equal(isProcessedOrderPaymentMatching("129.90", { ...getOrderShape, currency: "USD" }), false);
  assert.equal(isProcessedOrderPaymentMatching("129.90", { ...order, currency_id: undefined, currency: undefined }), false);
  assert.equal(isProcessedOrderPaymentMatching("130.00", order), false);
  assert.equal(isProcessedOrderPaymentMatching("129.90", { ...order, currency_id: "USD" }), false);
  assert.equal(isProcessedOrderPaymentMatching("129.90", { ...order, total_paid_amount: "100.00" }), false);
  assert.equal(isProcessedOrderPaymentMatching("129.90", { ...order, transactions: { payments: [{ status: "pending" }] } }), false);
  assert.equal(isProcessedOrderPaymentMatching("129.90", { ...order, transactions: { payments: [] } }), false);
});

test("exige que o corpo da notificação corresponda ao recurso assinado", () => {
  assert.equal(isWebhookNotificationResourceMatch({ type: "order", data: { id: "ORD-123" } }, "ORD-123"), true);
  assert.equal(isWebhookNotificationResourceMatch({ type: "order", data: { id: "ORD-456" } }, "ORD-123"), false);
  assert.equal(isWebhookNotificationResourceMatch({ type: "payment", data: { id: "ORD-123" } }, "ORD-123"), false);
  assert.equal(isWebhookNotificationResourceMatch({ type: "order", data: {} }, "ORD-123"), false);
  assert.equal(isWebhookNotificationResourceMatch(null, "ORD-123"), false);
});

test("extrai ID de evento numérico ou textual do corpo", () => {
  assert.equal(getWebhookNotificationId({ id: 987654321 }), "987654321");
  assert.equal(getWebhookNotificationId({ id: " event-123 " }), "event-123");
});

test("rejeita ID de evento ausente, inseguro ou excessivamente longo", () => {
  assert.equal(getWebhookNotificationId({}), null);
  assert.equal(getWebhookNotificationId({ id: -1 }), null);
  assert.equal(getWebhookNotificationId({ id: Number.MAX_SAFE_INTEGER + 1 }), null);
  assert.equal(getWebhookNotificationId({ id: "x".repeat(201) }), null);
  assert.equal(getWebhookNotificationId(null), null);
});


test("confere o recurso vinculado ao ID da notificação", () => {
  assert.equal(isWebhookResourceMatch("order-123", "order-123"), true);
  assert.equal(isWebhookResourceMatch("order-123", "order-456"), false);
  assert.equal(isWebhookResourceMatch(null, "order-123"), false);
  assert.equal(isWebhookResourceMatch("order-123", ""), false);
});


test("classifica reembolso integral e parcial somente com valores conferidos", () => {
  const base = {
    status: "processed",
    currency: "BRL",
    total_amount: "100.00",
    total_paid_amount: "100.00",
    transactions: { payments: [{ status: "processed" }] },
  };
  assert.equal(getOrderPaymentDisposition("100.00", base), "paid");
  assert.equal(getOrderPaymentDisposition("100.00", {
    ...base,
    status_detail: "partially_refunded",
    transactions: { ...base.transactions, refunds: [{ status: "processed", amount: "25.00" }] },
  }), "partial_refund");
  assert.equal(getOrderPaymentDisposition("100.00", {
    ...base,
    total_paid_amount: "0.00",
    status_detail: "partially_refunded",
    transactions: { ...base.transactions, refunds: [{ status: "processed", amount: "25.00" }] },
  }), "partial_refund");
  assert.equal(getOrderPaymentDisposition("100.00", {
    ...base,
    status: "refunded",
    status_detail: "refunded",
    transactions: { refunds: [{ status: "processed", amount: "100.00" }] },
  }), "refunded");
  assert.equal(getOrderPaymentDisposition("100.00", {
    ...base,
    status: "refunded",
    transactions: { refunds: [{ status: "processed", amount: "99.00" }] },
  }), "review");
  assert.equal(getOrderPaymentDisposition("100.00", {
    ...base,
    status_detail: "partially_refunded",
    transactions: { refunds: [{ status: "processing", amount: "25.00" }] },
  }), "review");
});

test("classifica chargeback parcial conforme o payload documentado da Orders API", () => {
  const base = {
    currency: "BRL",
    total_amount: "50.00",
    total_paid_amount: "200.00",
    status: "charged_back",
    transactions: {
      payments: [{ status: "charged_back" }],
      chargebacks: [{
        id: "CBK-1",
        transaction_id: "PAY-1",
        case_id: "CASE-1",
        status: "in_process",
        references: ["PAY-1"],
      }],
    },
  };

  // O objeto chargebacks pode não conter amount; o valor afetado vem de total_amount.
  assert.equal(getOrderPaymentDisposition("200.00", { ...base, status_detail: "in_process" }), "chargeback");
  assert.equal(getOrderPaymentDisposition("200.00", {
    ...base,
    status_detail: "settled",
    transactions: { ...base.transactions, chargebacks: [{ ...base.transactions.chargebacks[0], status: "settled" }] },
  }), "chargeback_resolved");
  assert.equal(getOrderPaymentDisposition("200.00", {
    ...base,
    status_detail: "reimbursed",
    transactions: { ...base.transactions, chargebacks: [{ ...base.transactions.chargebacks[0], status: "reimbursed" }] },
  }), "chargeback_resolved");
  assert.equal(getOrderPaymentDisposition("200.00", {
    ...base,
    total_amount: "250.00",
    status_detail: "in_process",
  }), "review");
  assert.equal(getOrderPaymentDisposition("200.00", {
    ...base,
    status_detail: "unknown",
  }), "review");
  assert.equal(getOrderPaymentDisposition("200.00", {
    ...base,
    currency: "USD",
    status_detail: "in_process",
  }), "review");
});

test("mantém cancelamento e estados não finais fora de pagamento aprovado", () => {
  const base = {
    currency: "BRL",
    total_amount: "100.00",
    total_paid_amount: "100.00",
    transactions: { payments: [{ status: "processed" }] },
  };
  assert.equal(getOrderPaymentDisposition("100.00", { ...base, status: "canceled" }), "review");
  assert.equal(getOrderPaymentDisposition("100.00", {
    ...base,
    status: "canceled",
    total_paid_amount: "0.00",
    transactions: { payments: [] },
  }), "not_paid");
  assert.equal(getOrderPaymentDisposition("100.00", {
    ...base,
    status: "failed",
    total_paid_amount: "0.00",
    transactions: { payments: [{ status: "rejected" }] },
  }), "not_paid");
  assert.equal(getOrderPaymentDisposition("100.00", {
    ...base,
    status: "canceled",
    total_paid_amount: "0.00",
    transactions: { payments: [{ status: "processed" }] },
  }), "review");
  assert.equal(getOrderPaymentDisposition("100.00", {
    ...base,
    status: "canceled",
    total_paid_amount: undefined,
    transactions: { payments: [] },
  }), "review");
  assert.equal(getOrderPaymentDisposition("100.00", { ...base, status: "processing" }), "review");
});
