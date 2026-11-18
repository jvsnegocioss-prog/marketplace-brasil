function classifyCheckoutCancellation(result) {
  if (result === true) {
    return { confirmed: true, code: "attempt_rejected" };
  }
  return { confirmed: false, code: "cancellation_pending" };
}

async function attemptCheckoutCancellation(cancelOperation) {
  try {
    return classifyCheckoutCancellation(await cancelOperation());
  } catch {
    return classifyCheckoutCancellation(false);
  }
}

function isConfirmedUnpaidCancellation(status, mercadoPagoOrderId) {
  return typeof status === "string" &&
    status.trim().toLowerCase() === "cancelado" &&
    (mercadoPagoOrderId === null || mercadoPagoOrderId === undefined || mercadoPagoOrderId === "");
}

module.exports = {
  classifyCheckoutCancellation,
  attemptCheckoutCancellation,
  isConfirmedUnpaidCancellation,
};
