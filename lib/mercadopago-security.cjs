const { createHmac, timingSafeEqual } = require("node:crypto");

function isValidWebhookTimestamp(ts, nowMs = Date.now()) {
  if (typeof ts !== "string" || !/^\d+$/.test(ts)) return false;
  const value = Number(ts);
  const timestampMs = ts.length >= 13 ? value : value * 1000;
  // Reject stale signatures as well as future timestamps. The 5-minute
  // tolerance matches the Mercado Pago Node SDK's documented default.
  return Number.isSafeInteger(value) &&
    Number.isFinite(timestampMs) &&
    Math.abs(nowMs - timestampMs) <= 5 * 60 * 1000;
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

function isDefinitiveOrderCreationRejection(status) {
  // These HTTP responses mean the create-order request was rejected, not merely delayed.
  // 409/423 can represent an earlier/in-flight idempotent operation; 429 and 5xx are retriable/ambiguous.
  return [400, 401, 403, 422].includes(status);
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

  if (expectedCents === null || currency !== "BRL") return "review";

  const status = String(mpOrder.status || "").trim().toLowerCase();
  const detail = String(mpOrder.status_detail || "").trim().toLowerCase();

  // Na Orders API, uma contestação pode representar apenas parte do total:
  // total_amount pode refletir o valor contestado, não o valor original do pedido.
  if (status === "charged_back") {
    const chargebacks = mpOrder.transactions && mpOrder.transactions.chargebacks;
    const validDetails = ["in_process", "settled", "reimbursed"];
    if (
      !Array.isArray(chargebacks) ||
      chargebacks.length === 0 ||
      !validDetails.includes(detail) ||
      orderAmountCents === null ||
      orderAmountCents <= 0 ||
      orderAmountCents > expectedCents
    ) return "review";

    for (const chargeback of chargebacks) {
      if (!chargeback || !validDetails.includes(String(chargeback.status || "").toLowerCase())) return "review";
    }
    return detail === "in_process" ? "chargeback" : "chargeback_resolved";
  }

  if (orderAmountCents !== expectedCents) return "review";
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

  // Cancelamento/falha sem pagamento: só classificar como não pago quando
  // total_paid_amount for explicitamente zero e nenhuma transação estiver processada.
  // Campo ausente ou qualquer contradição permanece em revisão manual.
  if (status === "canceled" || status === "failed") {
    const payments = mpOrder.transactions && mpOrder.transactions.payments;
    const paymentsAreConclusive = Array.isArray(payments) &&
      payments.every((payment) =>
        payment && typeof payment.status === "string" && payment.status.length > 0
      );
    const hasProcessedPayment = paymentsAreConclusive &&
      payments.some((payment) => payment.status === "processed");
    const hasRefunds = Array.isArray(refunds) && refunds.length > 0;
    if (paidAmountCents === 0 && paymentsAreConclusive && !hasProcessedPayment && !hasRefunds) return "not_paid";
    return "review";
  }

  if (paidAmountCents !== expectedCents) return "review";

  if (status === "processed") {
    return isProcessedOrderPaymentMatching(expectedTotal, mpOrder) ? "paid" : "review";
  }
  return "review";
}

function isWebhookResourceMatch(storedResourceId, incomingResourceId) {
  return typeof storedResourceId === "string" && storedResourceId.length > 0 &&
    typeof incomingResourceId === "string" && incomingResourceId.length > 0 &&
    storedResourceId === incomingResourceId;
}

function isWebhookNotificationResourceMatch(body, signedDataId) {
  if (!body || typeof body !== "object" || Array.isArray(body) || body.type !== "order") return false;
  const bodyId = body.data && body.data.id;
  if (typeof bodyId !== "string" && typeof bodyId !== "number") return false;
  return String(bodyId) === String(signedDataId);
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
  isDefinitiveOrderCreationRejection,
  isProcessedOrderPaymentMatching,
  getOrderPaymentDisposition,
  getWebhookNotificationId,
  isWebhookResourceMatch,
  isWebhookNotificationResourceMatch,
};
