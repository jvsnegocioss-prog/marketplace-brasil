const test = require("node:test");
const assert = require("node:assert/strict");
const {
  TOKEN_RE, UUID_RE, hashRecoveryToken, classifyRecoveryState, isTrustedCheckoutUrl,
} = require("../lib/checkout-recovery.cjs");

const token = "a".repeat(64);

test("aceita apenas token de recuperação aleatório em hexadecimal com 256 bits", () => {
  assert.equal(TOKEN_RE.test(token), true);
  assert.equal(TOKEN_RE.test("abc"), false);
  assert.equal(hashRecoveryToken(token).length, 64);
});

test("hash de recuperação não expõe o token original", () => {
  assert.notEqual(hashRecoveryToken(token), token);
  assert.equal(hashRecoveryToken(token), hashRecoveryToken(token.toUpperCase()));
  assert.equal(hashRecoveryToken("inválido"), null);
});

test("valida UUID da chave apenas como seletor autenticado", () => {
  assert.equal(UUID_RE.test("123e4567-e89b-42d3-a456-426614174000"), true);
  assert.equal(UUID_RE.test("pedido-123"), false);
});

test("classifica estados sem expor dados pessoais", () => {
  assert.equal(classifyRecoveryState("aguardando"), "pending");
  assert.equal(classifyRecoveryState("Pago"), "paid");
  assert.equal(classifyRecoveryState("Cancelado"), "cancelled");
  assert.equal(classifyRecoveryState("em separação"), "closed");
});

test("aceita somente checkout HTTPS hospedado no Mercado Pago Brasil", () => {
  assert.equal(isTrustedCheckoutUrl("https://www.mercadopago.com.br/checkout/v1/redirect?order_id=abc"), true);
  assert.equal(isTrustedCheckoutUrl("http://www.mercadopago.com.br/checkout"), false);
  assert.equal(isTrustedCheckoutUrl("https://evil.example/checkout"), false);
  assert.equal(isTrustedCheckoutUrl("javascript:alert(1)"), false);
});
