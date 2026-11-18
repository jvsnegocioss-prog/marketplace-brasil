"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { runReconciliation } = require("../scripts/mercadopago-reconciliation-runner.cjs");

function reply(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

function page(nextCursor = null, overrides = {}) {
  return {
    scanned: 2,
    reconciled: 1,
    waiting: 1,
    ambiguous: 0,
    skipped: 0,
    failed: 0,
    nextCursor,
    ...overrides,
  };
}

test("follows every cursor page and aggregates counters", async () => {
  const calls = [];
  const responses = [reply(page("cursor-2")), reply(page("cursor-3")), reply(page())];
  const result = await runReconciliation({
    baseUrl: "https://store.example",
    secret: "x".repeat(40),
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return responses.shift();
    },
  });

  assert.equal(calls.length, 3);
  assert.equal(new URL(calls[0].url).searchParams.get("cursor"), null);
  assert.equal(new URL(calls[1].url).searchParams.get("cursor"), "cursor-2");
  assert.equal(new URL(calls[2].url).searchParams.get("cursor"), "cursor-3");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Authorization, "Bearer " + "x".repeat(40));
  assert.deepEqual(result, {
    pages: 3, scanned: 6, reconciled: 3, waiting: 3,
    ambiguous: 0, skipped: 0, failed: 0,
  });
});

test("uses a 240-second request timeout", async () => {
  const originalTimeout = AbortSignal.timeout;
  let timeoutMs;
  AbortSignal.timeout = (ms) => { timeoutMs = ms; return new AbortController().signal; };
  try {
    await runReconciliation({
      baseUrl: "https://store.example", secret: "x".repeat(40),
      fetchImpl: async () => reply(page()),
    });
    assert.equal(timeoutMs, 240_000);
  } finally {
    AbortSignal.timeout = originalTimeout;
  }
});

test("rejects missing credentials and non-HTTPS URLs before calling fetch", async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return reply(page()); };
  await assert.rejects(runReconciliation({ baseUrl: "http://store.example", secret: "x".repeat(40), fetchImpl }));
  await assert.rejects(runReconciliation({ baseUrl: "https://store.example", secret: "", fetchImpl }));
  assert.equal(called, false);
});

test("stops on HTTP errors without exposing response bodies", async () => {
  await assert.rejects(
    runReconciliation({
      baseUrl: "https://store.example",
      secret: "x".repeat(40),
      fetchImpl: async () => reply({ secret: "must-not-leak" }, 503),
    }),
    /HTTP 503/
  );
});

test("rejects malformed counters and cursors", async () => {
  await assert.rejects(
    runReconciliation({
      baseUrl: "https://store.example", secret: "x".repeat(40),
      fetchImpl: async () => reply(page(null, { scanned: -1 })),
    }),
    /invalid scanned counter/
  );
  await assert.rejects(
    runReconciliation({
      baseUrl: "https://store.example", secret: "x".repeat(40),
      fetchImpl: async () => reply(page(42)),
    }),
    /invalid cursor/
  );
});

test("detects repeated cursors to avoid an infinite loop", async () => {
  let callCount = 0;
  await assert.rejects(
    runReconciliation({
      baseUrl: "https://store.example", secret: "x".repeat(40),
      fetchImpl: async () => {
        callCount += 1;
        return reply(page("same-cursor"));
      },
    }),
    /cursor repeated/
  );
  assert.equal(callCount, 2);
});

test("fails closed when the configured page limit is reached", async () => {
  let callCount = 0;
  await assert.rejects(
    runReconciliation({
      baseUrl: "https://store.example", secret: "x".repeat(40), maxPages: 2,
      fetchImpl: async () => { callCount += 1; return reply(page("cursor-" + callCount)); },
    }),
    /page limit reached/
  );
  assert.equal(callCount, 2);
});

test("returns aggregate totals so the CLI can fail on item-level errors", async () => {
  const result = await runReconciliation({
    baseUrl: "https://store.example", secret: "x".repeat(40),
    fetchImpl: async () => reply(page(null, { failed: 1 })),
  });
  assert.equal(result.failed, 1);
});
