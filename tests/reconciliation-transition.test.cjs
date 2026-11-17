const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isCanceledOrderStatus,
  getReconciliationTransition,
} = require("../lib/reconciliation-transition.cjs");

test("reconhece variações de status cancelado sem confundir outros estados", () => {
  for (const status of ["Cancelado", "cancelada", "Canceled", "CANCELLED"]) {
    assert.equal(isCanceledOrderStatus(status), true);
  }
  for (const status of ["Pago", "aguardando", "Revisão necessária", ""]) {
    assert.equal(isCanceledOrderStatus(status), false);
  }
});

test("pagamento confirmado após cancelamento exige revisão e nunca reativa o pedido", () => {
  const result = getReconciliationTransition("Cancelado", "paid");
  assert.deepEqual(result, {
    action: "set_status",
    status: "Revisão necessária",
    allowedCurrentStatuses: ["Cancelado"],
    failed: false,
    result: "review",
  });
  assert.notEqual(result.status, "Pago");
});

test("pagamento pendente em pedido cancelado não altera status nem libera estoque novamente", () => {
  assert.deepEqual(getReconciliationTransition("Cancelado", "pending"), {
    action: "none",
    failed: true,
    result: "waiting",
  });
});

test("cancelamento confirmado pelo provedor não executa restauração duplicada", () => {
  assert.deepEqual(getReconciliationTransition("Cancelado", "not_paid"), {
    action: "none",
    failed: false,
    result: "reconciled",
  });
});

test("estados financeiros inesperados em pedido cancelado vão para revisão manual", () => {
  for (const disposition of ["review", "chargeback", "chargeback_resolved", "refunded", "partial_refund"]) {
    const result = getReconciliationTransition("cancelada", disposition);
    assert.equal(result.action, "set_status");
    assert.equal(result.status, "Revisão necessária");
    assert.deepEqual(result.allowedCurrentStatuses, ["cancelada"]);
  }
});

test("pedido aguardando mantém as transições existentes e protegidas por CAS", () => {
  assert.deepEqual(getReconciliationTransition("aguardando", "paid"), {
    action: "set_status",
    status: "Pago",
    allowedCurrentStatuses: ["aguardando"],
    failed: false,
    result: "reconciled",
  });
  assert.deepEqual(getReconciliationTransition("aguardando", "not_paid"), {
    action: "cancel_unpaid",
    failed: false,
    result: "reconciled",
  });
});
