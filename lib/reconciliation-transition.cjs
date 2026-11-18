function isCanceledOrderStatus(status) {
  return ["cancelado", "cancelada", "canceled", "cancelled"].includes(
    String(status || "").trim().toLowerCase()
  );
}

function getReconciliationTransition(orderStatus, disposition) {
  const currentStatus = String(orderStatus || "").trim();
  if (isCanceledOrderStatus(currentStatus)) {
    if (disposition === "pending") {
      return { action: "none", failed: true, result: "waiting" };
    }
    if (disposition === "not_paid") {
      return { action: "none", failed: false, result: "reconciled" };
    }
    return {
      action: "set_status",
      status: "Revisão necessária",
      allowedCurrentStatuses: [currentStatus],
      failed: false,
      result: "review",
    };
  }

  if (disposition === "pending") {
    return { action: "none", failed: true, result: "waiting" };
  }
  if (disposition === "paid") {
    return { action: "set_status", status: "Pago", allowedCurrentStatuses: ["aguardando"], failed: false, result: "reconciled" };
  }
  if (disposition === "not_paid") {
    return { action: "cancel_unpaid", failed: false, result: "reconciled" };
  }
  if (disposition === "chargeback") {
    return { action: "set_status", status: "Em contestação", allowedCurrentStatuses: ["aguardando"], failed: false, result: "reconciled" };
  }
  if (["review", "chargeback_resolved"].includes(disposition)) {
    return { action: "set_status", status: "Revisão necessária", allowedCurrentStatuses: ["aguardando"], failed: false, result: "review" };
  }
  if (["refunded", "partial_refund"].includes(disposition)) {
    return {
      action: "set_status",
      status: disposition === "refunded" ? "Reembolsado" : "Reembolso parcial",
      allowedCurrentStatuses: ["aguardando"],
      failed: false,
      result: "reconciled",
    };
  }
  return { action: "none", failed: true, result: "failed" };
}

module.exports = { isCanceledOrderStatus, getReconciliationTransition };
