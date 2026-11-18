export const TOKEN_RE: RegExp;
export const UUID_RE: RegExp;

export function hashRecoveryToken(token: unknown): string | null;
export function classifyRecoveryState(orderStatus: unknown): "pending" | "paid" | "cancelled" | "closed";
export function isTrustedCheckoutUrl(value: unknown): boolean;
