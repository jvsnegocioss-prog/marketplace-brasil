const TOKEN_RE = /^[0-9a-f]{64}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hashRecoveryToken(token) {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return null;
  return require("node:crypto").createHash("sha256").update(token.toLowerCase()).digest("hex");
}

function classifyRecoveryState(orderStatus) {
  const status = typeof orderStatus === "string" ? orderStatus.trim().toLowerCase() : "";
  if (status === "aguardando" || status === "pending") return "pending";
  if (/pago|aprovado|processado|paid|approved/.test(status)) return "paid";
  if (/cancel/.test(status)) return "cancelled";
  return "closed";
}

function isTrustedCheckoutUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname === "mercadopago.com.br" || url.hostname.endsWith(".mercadopago.com.br"));
  } catch {
    return false;
  }
}

module.exports = { TOKEN_RE, UUID_RE, hashRecoveryToken, classifyRecoveryState, isTrustedCheckoutUrl };
