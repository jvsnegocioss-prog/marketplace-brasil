export function isValidWebhookTimestamp(ts: string, nowMs?: number): boolean;
export function verifyMercadoPagoSignature(secret: string, dataId: string, requestId: string, ts: string, receivedHash: string): boolean;
export function amountToCents(value: unknown): number | null;
export function isProcessedOrderPaymentMatching(expectedTotal: unknown, mpOrder: any): boolean;
export function getWebhookNotificationId(body: unknown): string | null;
export function isWebhookResourceMatch(storedResourceId: unknown, incomingResourceId: unknown): boolean;
export function getOrderPaymentDisposition(expectedTotal: unknown, mpOrder: any): "paid" | "not_paid" | "refunded" | "partial_refund" | "chargeback" | "chargeback_resolved" | "review";
