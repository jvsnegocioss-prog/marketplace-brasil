const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveCheckoutAttempt } = require("../lib/checkout-attempt.cjs");

const key = "123e4567-e89b-42d3-a456-426614174000";
const fingerprint = "a".repeat(64);

test("cria uma tentativa nova somente quando não existe tentativa salva", () => {
  const result = resolveCheckoutAttempt(null, fingerprint, "user-1", () => key);
  assert.deepEqual(result, {
    ok: true,
    created: true,
    attempt: { fingerprint, userId: "user-1", key },
  });
});

test("retoma a mesma tentativa quando payload e identidade coincidem", () => {
  const saved = { fingerprint, userId: "user-1", key };
  assert.deepEqual(resolveCheckoutAttempt(saved, fingerprint, "user-1", () => {
    throw new Error("não deve gerar outra chave");
  }), { ok: true, created: false, attempt: saved });
});

test("bloqueia reutilização da tentativa em outra conta", () => {
  const saved = { fingerprint, userId: "user-1", key };
  assert.deepEqual(resolveCheckoutAttempt(saved, fingerprint, "user-2", () => key), {
    ok: false, reason: "identity_mismatch",
  });
});

test("bloqueia uma nova chave quando o payload muda", () => {
  const saved = { fingerprint, userId: "user-1", key };
  assert.deepEqual(resolveCheckoutAttempt(saved, "b".repeat(64), "user-1", () => key), {
    ok: false, reason: "payload_mismatch",
  });
});

test("registro legado sem userId só retoma com fingerprint idêntico", () => {
  const saved = { fingerprint, key };
  assert.equal(resolveCheckoutAttempt(saved, fingerprint, null, () => key).ok, true);
  assert.deepEqual(resolveCheckoutAttempt(saved, "b".repeat(64), null, () => key), {
    ok: false, reason: "payload_mismatch",
  });
});

test("falha de forma segura para registros salvos inválidos", () => {
  assert.deepEqual(resolveCheckoutAttempt({ key: "inválida", fingerprint }, fingerprint, null, () => key), {
    ok: false, reason: "invalid",
  });
});
const {
  classifyCheckoutCancellation,
  attemptCheckoutCancellation,
  isConfirmedUnpaidCancellation,
} = require("../lib/checkout-cancellation.cjs");

test("só confirma liberação da tentativa quando o banco confirma cancelamento", () => {
  assert.deepEqual(classifyCheckoutCancellation(true), {
    confirmed: true,
    code: "attempt_rejected",
  });
});

test("mantém tentativa pendente quando cancelamento retorna false", () => {
  assert.deepEqual(classifyCheckoutCancellation(false), {
    confirmed: false,
    code: "cancellation_pending",
  });
});

test("mantém tentativa pendente para respostas ausentes ou inesperadas", () => {
  for (const result of [null, undefined, 0, "true", {}]) {
    assert.deepEqual(classifyCheckoutCancellation(result), {
      confirmed: false,
      code: "cancellation_pending",
    });
  }
});

test("trata erro retornado pela RPC como recuperação pendente", async () => {
  const result = await attemptCheckoutCancellation(async () => false);
  assert.deepEqual(result, { confirmed: false, code: "cancellation_pending" });
});

test("trata exceção durante cancelamento como recuperação pendente", async () => {
  const result = await attemptCheckoutCancellation(async () => {
    throw new Error("falha simulada da RPC");
  });
  assert.deepEqual(result, { confirmed: false, code: "cancellation_pending" });
});

test("só reconhece pedido cancelado sem vínculo local de pagamento como encerrado recuperável", () => {
  assert.equal(isConfirmedUnpaidCancellation("Cancelado", null), true);
  assert.equal(isConfirmedUnpaidCancellation(" cancelado ", undefined), true);
  assert.equal(isConfirmedUnpaidCancellation("Pago", null), false);
  assert.equal(isConfirmedUnpaidCancellation("Cancelado", "mp-order-123"), false);
  assert.equal(isConfirmedUnpaidCancellation("aguardando", null), false);
});
