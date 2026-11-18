export type CheckoutCancellationOutcome =
  | { confirmed: true; code: "attempt_rejected" }
  | { confirmed: false; code: "cancellation_pending" };

export function classifyCheckoutCancellation(result: unknown): CheckoutCancellationOutcome;
export function attemptCheckoutCancellation(cancelOperation: () => unknown | Promise<unknown>): Promise<CheckoutCancellationOutcome>;
export function isConfirmedUnpaidCancellation(status: unknown, mercadoPagoOrderId: unknown): boolean;
