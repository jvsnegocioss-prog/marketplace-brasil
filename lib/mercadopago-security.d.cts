export function isDefinitiveOrderCreationRejection(status: number): boolean;
export function isValidWebhookTimestamp(ts: string, nowMs?: number): boolean;
export function verifyMercadoPagoSignature(secret: string, dataId: string, requestId: string, ts: string, receivedHash: string): boolean;
export function amountToCents(value: unknown): number | null;
export function isProcessedOrderPaymentMatching(expectedTotal: unknown, mpOrder: any): boolean;
export function getWebhookNotificationId(body: unknown): string | null;
export function isWebhookResourceMatch(storedResourceId: unknown, incomingResourceId: unknown): boolean;
export function getOrderPaymentDisposition(expectedTotal: unknown, mpOrder: any): "paid" | "pending" | "not_paid" | "refunded" | "partial_refund" | "chargeback" | "chargeback_resolved" | "review";
export function isWebhookNotificationResourceMatch(body: unknown, signedDataId: unknown): boolean;

export function selectUniqueOrderByExternalReference(orders: unknown, expectedExternalReference: string): {
  status: "invalid_reference" | "invalid_response" | "not_found" | "ambiguous" | "invalid_order" | "matched";
  order: any | null;
};
export function readOrderSearchPage(response: unknown): {
  status: "valid" | "invalid_response";
  orders: any[];
  nextOffset: number | null;
  total: number | null;
};
export function selectUniqueOrderAcrossSearchPages(pages: unknown, expectedExternalReference: string): {
  status: "invalid_response" | "invalid_reference" | "not_found" | "ambiguous" | "invalid_order" | "matched";
  order: any | null;
};
export function isSafeOrderLinkCandidate(storedResourceId: unknown, candidateResourceId: unknown): boolean;
