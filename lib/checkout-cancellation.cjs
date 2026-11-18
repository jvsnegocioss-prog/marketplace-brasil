function classifyCheckoutCancellation(result) {
  if (result === true) {
    return { confirmed: true, code: "attempt_rejected" };
  }
  return { confirmed: false, code: "cancellation_pending" };
}

module.exports = { classifyCheckoutCancellation };
