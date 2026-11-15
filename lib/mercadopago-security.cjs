const { createHmac, timingSafeEqual } = require("node:crypto");

function isValidWebhookTimestamp(ts, nowMs = Date.now()) {
  if (typeof ts !== "string" || !/^\d+$/.test(ts)) return false;
  const value = Number(ts);
  const timestampMs = ts.length >= 13 ? value : value * 1000;
  return Number.isSafeInteger(value) &&
    Number.isFinite(timestampMs) &&
    timestampMs <= nowMs + 5 * 60 * 1000;
}

function verifyMercadoPagoSignature(secret, dataId, requestId, ts, receivedHash) {
  if (typeof receivedHash !== "string" || !/^[a-f0-9]{64}$/i.test(receivedHash)) return false;
  const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${ts};`;
  const expected = createHmac("sha256", secret).update(manifest).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const receivedBuffer = Buffer.from(receivedHash, "hex");
  return expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer);
}

function amountToCents(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}

function isProcessedOrderPaymentMatching(expectedTotal, mpOrder) {
  const expectedCents = amountToCents(expectedTotal);
  const orderAmountCents = amountToCents(mpOrder && mpOrder.total_amount);
  const paidAmountCents = amountToCents(mpOrder && mpOrder.total_paid_amount);
  const payments = mpOrder && mpOrder.transactions && mpOrder.transactions.payments;
  const paymentsAreProcessed = Array.isArray(payments) &&
    payments.length > 0 &&
    payments.every((payment) => payment && payment.status === "processed");
  const currency = mpOrder && (mpOrder.currency ?? mpOrder.currency_id);
  return mpOrder && currency === "BRL" &&
    expectedCents !== null &&
    orderAmountCents === expectedCents &&
    paidAmountCents === expectedCents &&
    paymentsAreProcessed;
}

// Classifica estados que exigem tratamento diferente de um pagamento aprovado.
// Qualquer estrutura incompleta ou contraditória cai em revisão manual (fail closed).
function getOrderPaymentDisposition(expectedTotal, mpOrder) {
  const expectedCents = amountToCents(expectedTotal);
  const orderAmountCents = amountToCents(mpOrder && mpOrder.total_amount);
  const paidAmountCents = amountToCents(mpOrder && mpOrder.total_paid_amount);
  const currency = mpOrder && (mpOrder.currency ?? mpOrder.currency_id);

  if (
    expectedCents === null ||
    orderAmountCents !== expectedCents ||
    currency !== "BRL"
  ) return "review";

  const status = String(mpOrder.status || "").trim().toLowerCase();
  const detail = String(mpOrder.status_detail || "").trim().toLowerCase();

  // A contestação é classificada antes de comparar o total pago: a própria
  // resposta de chargeback pode refletir valores afetados diferentes do total.
  if (status === "charged_back") return "chargeback";
  if (paidAmountCents !== expectedCents) return "review";

  const refunds = mpOrder.transactions && mpOrder.transactions.refunds;
  if (status === "refunded" || detail === "partially_refunded") {
    if (!Array.isArray(refunds) || refunds.length === 0) return "review";
    let refundedCents = 0;
    for (const refund of refunds) {
      if (!refund || refund.status !== "processed") return "review";
      const amount = amountToCents(refund.amount);
      if (amount === null || amount <= 0) return "review";
      refundedCents += amount;
      if (!Number.isSafeInteger(refundedCents) || refundedCents > expectedCents) return "review";
    }
    if (status === "refunded") {
      return refundedCents === expectedCents ? "refunded" : "review";
    }
    return refundedCents > 0 && refundedCents < expectedCents ? "partial_refund" : "review";
  }

  if (status === "processed") {
    return isProcessedOrderPaymentMatching(expectedTotal, mpOrder) ? "paid" : "review";
  }
  if (status === "canceled" || status === "failed") return "not_paid";
  return "review";
}

function isWebhookResourceMatch(storedResourceId, incomingResourceId) {
  return typeof storedResourceId === "string" && storedResourceId.length > 0 &&
    typeof incomingResourceId === "string" && incomingResourceId.length > 0 &&
    storedResourceId === incomingResourceId;
}

function getWebhookNotificationId(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const rawId = body.id;
  if (typeof rawId === "string") {
    const value = rawId.trim();
    return value.length > 0 && value.length <= 200 ? value : null;
  }
  if (typeof rawId === "number" && Number.isSafeInteger(rawId) && rawId >= 0) {
    return String(rawId);
  }
  return null;
}

module.exports = {
  isValidWebhookTimestamp,
  verifyMercadoPagoSignature,
  amountToCents,
  isProcessedOrderPaymentMatching,
  getOrderPaymentDisposition,
  getWebhookNotificationId,
  isWebhookResourceMatch,
};
