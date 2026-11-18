const test = require("node:test");
const assert = require("node:assert/strict");
const { isValidTrackingPhone } = require("../lib/tracking-phone-validation.cjs");

test("aceita telefone brasileiro com DDD em formato local", () => {
  assert.equal(isValidTrackingPhone("(92) 98470-8714"), true);
});

test("aceita telefone brasileiro com código do país", () => {
  assert.equal(isValidTrackingPhone("+55 92 98470-8714"), true);
});

test("rejeita letras, ausência de dígitos e números curtos", () => {
  assert.equal(isValidTrackingPhone("abcdefghij"), false);
  assert.equal(isValidTrackingPhone(""), false);
  assert.equal(isValidTrackingPhone("98470-871"), false);
});

test("rejeita entradas excessivamente longas ou de tipo incorreto", () => {
  assert.equal(isValidTrackingPhone("55119999999999999"), false);
  assert.equal(isValidTrackingPhone(null), false);
  assert.equal(isValidTrackingPhone(92984708714), false);
});
