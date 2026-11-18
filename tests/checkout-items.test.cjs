const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeCheckoutItems } = require("../lib/checkout-items.cjs");

const productA = "123e4567-e89b-42d3-a456-426614174000";
const productB = "123e4567-e89b-42d3-a456-426614174001";

test("consolida linhas repetidas do mesmo produto antes da criação do pedido", () => {
  const result = normalizeCheckoutItems([
    { id: productA, qty: 2 },
    { id: productB, qty: 1 },
    { id: productA.toUpperCase(), qty: 3 },
  ]);
  assert.deepEqual(result, {
    ok: true,
    items: [
      { id: productA, qty: 5 },
      { id: productB, qty: 1 },
    ],
  });
});

test("rejeita item nulo, array ou estrutura inesperada sem lançar exceção", () => {
  for (const value of [null, [null], [[]], [{ id: productA }], [{ id: productA, qty: 1 }, null]]) {
    assert.deepEqual(normalizeCheckoutItems(value), { ok: false, items: [] });
  }
});

test("rejeita identificadores de produto que não sejam UUIDs", () => {
  for (const id of ["", "produto-1", "123", null, 123]) {
    assert.deepEqual(normalizeCheckoutItems([{ id, qty: 1 }]), { ok: false, items: [] });
  }
});

test("rejeita quantidades inválidas, fracionadas ou fora do limite inteiro do PostgreSQL", () => {
  for (const qty of [0, -1, 1.5, "2", NaN, Infinity, 2_147_483_648]) {
    assert.deepEqual(normalizeCheckoutItems([{ id: productA, qty }]), { ok: false, items: [] });
  }
});

test("rejeita soma de quantidades repetidas que exceda o limite inteiro do PostgreSQL", () => {
  assert.deepEqual(normalizeCheckoutItems([
    { id: productA, qty: 2_147_483_647 },
    { id: productA, qty: 1 },
  ]), { ok: false, items: [] });
});

test("mantém limite de quantidade de linhas e exige carrinho não vazio", () => {
  assert.deepEqual(normalizeCheckoutItems([]), { ok: false, items: [] });
  assert.deepEqual(normalizeCheckoutItems(Array.from({ length: 101 }, () => ({ id: productA, qty: 1 }))), {
    ok: false,
    items: [],
  });
});
