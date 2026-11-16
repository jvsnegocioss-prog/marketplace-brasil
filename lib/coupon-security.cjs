"use strict";

function calculateCouponDiscount({ subtotalCents, discountType, discountValue, maxDiscount = null }) {
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents <= 1) return null;
  if (discountType !== "percent" && discountType !== "fixed") return null;

  const value = Number(discountValue);
  if (!Number.isFinite(value) || value <= 0) return null;

  let discountCents = discountType === "percent"
    ? Math.round(subtotalCents * value / 100)
    : Math.round(value * 100);

  if (!Number.isSafeInteger(discountCents) || discountCents <= 0) return null;

  if (maxDiscount !== null && maxDiscount !== undefined) {
    const maximumCents = Math.round(Number(maxDiscount) * 100);
    if (!Number.isSafeInteger(maximumCents) || maximumCents < 0) return null;
    discountCents = Math.min(discountCents, maximumCents);
  }

  discountCents = Math.min(discountCents, subtotalCents);
  if (discountCents <= 0 || discountCents >= subtotalCents) return null;

  return { discountCents, totalCents: subtotalCents - discountCents };
}

module.exports = { calculateCouponDiscount };
