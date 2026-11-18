export type CheckoutAttempt = {
  fingerprint: string;
  userId: string | null;
  key: string;
};

export type CheckoutAttemptDecision =
  | { ok: true; created: boolean; attempt: CheckoutAttempt }
  | { ok: false; reason: "invalid" | "identity_mismatch" | "payload_mismatch" };

export function resolveCheckoutAttempt(
  savedAttempt: unknown,
  fingerprint: string,
  userId: string | null,
  createKey: () => string
): CheckoutAttemptDecision;