import { createHmac, timingSafeEqual } from "node:crypto";

export type MercadoPagoWebhookAction = "approve" | "cancel" | "reconcile" | "ignore";

export function createMercadoPagoWebhookSignature(
  secret: string,
  dataId: string,
  requestId: string,
  timestamp: string
): string {
  const normalizedDataId = dataId.toLowerCase();
  const manifest = `id:${normalizedDataId};request-id:${requestId};ts:${timestamp};`;
  return createHmac("sha256", secret).update(manifest).digest("hex");
}

export function compareSignatures(expected: string, received: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(expected) || !/^[a-f0-9]{64}$/i.test(received)) return false;
  const expectedBuffer = Buffer.from(expected, "hex");
  const receivedBuffer = Buffer.from(received, "hex");
  return expectedBuffer.length === receivedBuffer.length &&
    expectedBuffer.length > 0 &&
    timingSafeEqual(expectedBuffer, receivedBuffer);
}

export function amountToCents(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const cents = Math.round(amount * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function classifyMercadoPagoOrderStatus(status: unknown): MercadoPagoWebhookAction {
  if (status === "processed") return "approve";
  if (status === "canceled" || status === "failed") return "cancel";
  if (status === "refunded" || status === "charged_back") return "reconcile";
  return "ignore";
}

export function validateProcessedPayment(
  storeTotal: unknown,
  mercadoPagoOrder: {
    currency_id?: unknown;
    total_amount?: unknown;
    total_paid_amount?: unknown;
    transactions?: { payments?: unknown };
  }
): { valid: boolean; reason?: string } {
  const expectedCents = amountToCents(storeTotal);
  const orderAmountCents = amountToCents(mercadoPagoOrder.total_amount);
  const paidAmountCents = amountToCents(mercadoPagoOrder.total_paid_amount);
  const payments = mercadoPagoOrder.transactions?.payments;
  const paymentsAreProcessed =
    Array.isArray(payments) &&
    payments.length > 0 &&
    payments.every((payment) =>
      Boolean(payment) && typeof payment === "object" &&
      (payment as { status?: unknown }).status === "processed"
    );

  if (mercadoPagoOrder.currency_id !== "BRL") return { valid: false, reason: "currency_mismatch" };
  if (expectedCents === null || orderAmountCents === null || paidAmountCents === null) {
    return { valid: false, reason: "invalid_amount" };
  }
  if (orderAmountCents !== expectedCents) return { valid: false, reason: "order_amount_mismatch" };
  if (paidAmountCents !== expectedCents) return { valid: false, reason: "paid_amount_mismatch" };
  if (!paymentsAreProcessed) return { valid: false, reason: "transactions_not_processed" };
  return { valid: true };
}
