"use strict";

const RECONCILIATION_PATH = "/api/mercadopago/reconcile";
const DEFAULT_MAX_PAGES = 40;

async function runReconciliation({
  baseUrl,
  secret,
  fetchImpl = globalThis.fetch,
  maxPages = DEFAULT_MAX_PAGES,
}) {
  if (typeof baseUrl !== "string" || !/^https:\/\//i.test(baseUrl)) {
    throw new Error("A valid HTTPS reconciliation base URL is required.");
  }
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("The reconciliation secret is missing or too short.");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch is unavailable in this runtime.");
  }
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) {
    throw new Error("maxPages must be an integer between 1 and 100.");
  }

  const totals = {
    pages: 0,
    scanned: 0,
    reconciled: 0,
    waiting: 0,
    ambiguous: 0,
    skipped: 0,
    failed: 0,
  };
  let cursor = null;
  const seenCursors = new Set();

  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    const url = new URL(RECONCILIATION_PATH, baseUrl);
    if (cursor) url.searchParams.set("cursor", cursor);

    let response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + secret,
          Accept: "application/json",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new Error("Reconciliation request failed before a response was received.");
    }

    if (!response || !response.ok) {
      const status = response && Number.isInteger(response.status) ? response.status : "unknown";
      throw new Error("Reconciliation endpoint returned HTTP " + status + ".");
    }

    let body;
    try {
      body = await response.json();
    } catch {
      throw new Error("Reconciliation endpoint returned invalid JSON.");
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("Reconciliation endpoint returned an invalid result.");
    }

    for (const key of ["scanned", "reconciled", "waiting", "ambiguous", "skipped", "failed"]) {
      if (!Number.isSafeInteger(body[key]) || body[key] < 0) {
        throw new Error("Reconciliation endpoint returned an invalid " + key + " counter.");
      }
      totals[key] += body[key];
    }
    totals.pages += 1;

    if (body.nextCursor === null) return totals;
    if (typeof body.nextCursor !== "string" || body.nextCursor.length === 0) {
      throw new Error("Reconciliation endpoint returned an invalid cursor.");
    }
    if (seenCursors.has(body.nextCursor)) {
      throw new Error("Reconciliation cursor repeated; stopping to prevent a loop.");
    }
    seenCursors.add(body.nextCursor);
    cursor = body.nextCursor;
  }

  throw new Error("Reconciliation page limit reached before all pending orders were scanned.");
}

if (require.main === module) {
  runReconciliation({
    baseUrl: process.env.MERCADO_PAGO_RECONCILIATION_BASE_URL,
    secret: process.env.MERCADO_PAGO_RECONCILIATION_SECRET,
  }).then((totals) => {
    // Only aggregate counters are printed; credentials and response payloads are never logged.
    process.stdout.write(JSON.stringify(totals) + "\n");
    if (totals.failed > 0) process.exitCode = 1;
  }).catch((error) => {
    process.stderr.write("Mercado Pago reconciliation failed: " + error.message + "\n");
    process.exitCode = 1;
  });
}

module.exports = { runReconciliation };
