const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateCouponDiscount } = require("../lib/coupon-security.cjs");

test("calcula desconto percentual em centavos sem erro de arredondamento", () => {
  assert.deepEqual(calculateCouponDiscount({
    subtotalCents: 1999, discountType: "percent", discountValue: 10,
  }), { discountCents: 200, totalCents: 1799 });
});

test("calcula desconto fixo e respeita desconto máximo", () => {
  assert.deepEqual(calculateCouponDiscount({
    subtotalCents: 10000, discountType: "fixed", discountValue: "35.50", maxDiscount: "20",
  }), { discountCents: 2000, totalCents: 8000 });
});

test("limita percentual ao subtotal e rejeita compra sem total positivo", () => {
  assert.equal(calculateCouponDiscount({
    subtotalCents: 500, discountType: "percent", discountValue: 150,
  }), null);
  assert.equal(calculateCouponDiscount({
    subtotalCents: 1, discountType: "fixed", discountValue: 0.01,
  }), null);
});

test("falha fechada para tipo, valor e limite de desconto inválidos", () => {
  for (const input of [
    { subtotalCents: 1000, discountType: "unknown", discountValue: 10 },
    { subtotalCents: 1000, discountType: "fixed", discountValue: "NaN" },
    { subtotalCents: 1000, discountType: "fixed", discountValue: -1 },
    { subtotalCents: 1000, discountType: "fixed", discountValue: 10, maxDiscount: "invalid" },
    { subtotalCents: Number.MAX_SAFE_INTEGER + 1, discountType: "fixed", discountValue: 10 },
  ]) assert.equal(calculateCouponDiscount(input), null);
});

test("rejeita desconto zero ou igual ao valor total do carrinho", () => {
  assert.equal(calculateCouponDiscount({
    subtotalCents: 1000, discountType: "fixed", discountValue: 0,
  }), null);
  assert.equal(calculateCouponDiscount({
    subtotalCents: 1000, discountType: "fixed", discountValue: 10,
  }), null);
});
