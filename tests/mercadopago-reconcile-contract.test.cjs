const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const route = fs.readFileSync(
  path.join(__dirname, "..", "app", "api", "mercadopago", "reconcile", "route.ts"),
  "utf8"
);

test("reconciliação exige segredo e compara credencial em tempo constante", () => {
  const secretCheck = route.indexOf('const secret = process.env.MERCADO_PAGO_RECONCILIATION_SECRET');
  const adminCall = route.indexOf('const db = admin()');
  assert.notEqual(secretCheck, -1);
  assert.ok(secretCheck < adminCall, "a autenticação deve ocorrer antes de inicializar acesso administrativo");
  assert.match(route, /timingSafeEqual\(expectedBuffer, suppliedBuffer\)/);
  assert.match(route, /return fail\("Unauthorized\.", 401\)/);
});

test("busca externa usa GET, pagina até o fim e rejeita lote incompleto", () => {
  assert.match(route, /https:\/\/api\.mercadopago\.com\/v1\/orders/);
  assert.match(route, /method:\s*"GET"/);
  assert.match(route, /MAX_PAGES\s*=\s*10/);
  assert.match(route, /if \(!complete\) return \{ status: "invalid_response" as const \}/);
  assert.match(route, /selectUniqueOrderAcrossSearchPages\(pages, orderId\)/);
});

test("busca vazia nunca cancela pedido nem libera estoque", () => {
  assert.match(route, /if \(found\.status === "not_found" \|\| found\.status === "outside_search_window"\)[\s\S]*?result\.waiting \+= 1;\s*continue;/);
  const notFoundBlock = route.slice(
    route.indexOf('if (found.status === "not_found"'),
    route.indexOf('if (found.status === "ambiguous"')
  );
  assert.doesNotMatch(notFoundBlock, /finalize\(|cancel_unpaid|restore_stock/i);
});

test("vínculo externo usa compare-and-set e confirmação exata da referência", () => {
  assert.match(route, /String\(mpOrder\.id \?\? ""\) !== mpId/);
  assert.match(route, /String\(mpOrder\.external_reference \?\? ""\) !== id/);
  assert.match(route, /\.ilike\("status", "aguardando"\)[\s\S]*?\.is\("mercado_pago_order_id", null\)/);
  assert.match(route, /isSafeOrderLinkCandidate\(order\.mercado_pago_order_id, mpId\)/);
});

test("reconciliação usa leases existentes e não cria pedidos nem pagamentos", () => {
  assert.match(route, /register_mercado_pago_webhook_delivery/);
  assert.match(route, /claim_mercado_pago_webhook_event/);
  assert.match(route, /finalize_mercado_pago_webhook_event/);
  assert.doesNotMatch(route, /method:\s*"POST"[\s\S]*?api\.mercadopago\.com/);
  assert.doesNotMatch(route, /\.from\("orders"\)\s*\.insert\(/);
});

test("processamento por lotes oferece cursor e limite explícito", () => {
  assert.match(route, /MAX_ORDERS\s*=\s*25/);
  assert.match(route, /searchParams\.get\("cursor"\)/);
  assert.match(route, /nextCursor/);
});
