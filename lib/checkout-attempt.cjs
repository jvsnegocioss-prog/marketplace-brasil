const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/i;

function resolveCheckoutAttempt(savedAttempt, fingerprint, userId, createKey) {
  if (typeof fingerprint !== "string" || !SHA256_RE.test(fingerprint)) {
    return { ok: false, reason: "invalid" };
  }

  if (savedAttempt === null || savedAttempt === undefined) {
    const key = createKey();
    if (typeof key !== "string" || !UUID_RE.test(key)) {
      return { ok: false, reason: "invalid" };
    }
    return {
      ok: true,
      created: true,
      attempt: { fingerprint, userId, key },
    };
  }

  if (typeof savedAttempt !== "object" || Array.isArray(savedAttempt) ||
      typeof savedAttempt.key !== "string" || !UUID_RE.test(savedAttempt.key) ||
      typeof savedAttempt.fingerprint !== "string" || !SHA256_RE.test(savedAttempt.fingerprint)) {
    return { ok: false, reason: "invalid" };
  }

  // Registros antigos não tinham userId. Eles só podem ser retomados com o
  // fingerprint idêntico; a idempotência do servidor ainda valida a identidade.
  if (Object.prototype.hasOwnProperty.call(savedAttempt, "userId") && savedAttempt.userId !== userId) {
    return { ok: false, reason: "identity_mismatch" };
  }
  if (savedAttempt.fingerprint.toLowerCase() !== fingerprint.toLowerCase()) {
    return { ok: false, reason: "payload_mismatch" };
  }

  return { ok: true, created: false, attempt: savedAttempt };
}

module.exports = { resolveCheckoutAttempt };