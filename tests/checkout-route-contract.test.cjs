const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const routePath = path.join(__dirname, "../app/api/checkout/route.ts");
const source = fs.readFileSync(routePath, "utf8");

test("checkout mantém vendas suspensas quando a flag do servidor não está ativa", () => {
  assert.match(source, /process\.env\.STORE_SALES_ENABLED !== "true"/);
  assert.match(source, /As vendas estão temporariamente suspensas/);
});

test("checkout falha fechado quando faltam credenciais administrativas do Supabase", () => {
  assert.match(source, /const serviceRoleKey = process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source, /if \(!supabaseUrl \|\| !serviceRoleKey\)/);
  assert.match(source, /Configuração do serviço indisponível/);
});

test("checkout registra o pedido por RPC no servidor, sem confiar em IDs de pedido do navegador", () => {
  assert.match(source, /create_store_order_with_coupon_and_delivery_for_customer/);
  assert.match(source, /p_checkout_idempotency_key: checkoutIdempotencyKey/);
  assert.match(source, /p_checkout_request_hash: requestHash/);
});

test("checkout usa Mercado Pago Orders API com chave de idempotência", () => {
  assert.match(source, /https:\/\/api\.mercadopago\.com\/v1\/orders/);
  assert.match(source, /"X-Idempotency-Key": mercadoPagoIdempotencyKey\(orderId\)/);
  assert.match(source, /paymentData\.checkout_url/);
});

test("checkout não informa sucesso sem confirmar o vínculo do pagamento ao pedido", () => {
  assert.match(source, /paymentLinkConfirmed/);
  assert.match(source, /VÍNCULO MERCADO PAGO NÃO CONFIRMADO/);
  assert.match(source, /return NextResponse\.json\(\{\s*success: true/);
});
