const test = require("node:test");
const assert = require("node:assert/strict");
const { escapePostgrestLikePattern } = require("../lib/email-filter-security.cjs");

test("escapes LIKE and PostgREST wildcard characters in exact email filters", () => {
  assert.equal(
    escapePostgrestLikePattern("client%_name*\\mail@example.com"),
    "client\\%\\_name\\*\\\\mail@example.com"
  );
});

test("preserves ordinary email characters and casing", () => {
  assert.equal(
    escapePostgrestLikePattern("Cliente.Sobrenome+tag@Example.com"),
    "Cliente.Sobrenome+tag@Example.com"
  );
});

test("fails closed for non-string values", () => {
  assert.equal(escapePostgrestLikePattern(null), "");
  assert.equal(escapePostgrestLikePattern(undefined), "");
});
