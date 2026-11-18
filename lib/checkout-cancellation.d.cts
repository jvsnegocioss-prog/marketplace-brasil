export type CheckoutCancellationOutcome =
  | { confirmed: true; code: "attempt_rejected" }
  | { confirmed: false; code: "cancellation_pending" };

export function classifyCheckoutCancellation(result: unknown): CheckoutCancellationOutcome;
