const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migrationDir = path.join(__dirname, "..", "supabase", "migrations");
const registerSql = fs.readFileSync(
  path.join(migrationDir, "20261115225848_register_mercado_pago_webhook_delivery.sql"),
  "utf8"
);
const leaseSql = fs.readFileSync(
  path.join(migrationDir, "20261115234248_protect_mercado_pago_webhook_processing_leases.sql"),
  "utf8"
);

function functionBody(sql, functionName) {
  const start = sql.toLowerCase().indexOf(`function public.${functionName.toLowerCase()}`);
  assert.notEqual(start, -1, `função SQL ausente: ${functionName}`);
  const dollarEnd = sql.indexOf("$;", start);
  const namedEnd = sql.indexOf("$function$;", start);
  const ends = [dollarEnd, namedEnd].filter((value) => value !== -1);
  assert.ok(ends.length > 0, `fim da função SQL ausente: ${functionName}`);
  return sql.slice(start, Math.min(...ends));
}

test("registro de webhook serializa IDs repetidos e rejeita recurso divergente", () => {
  const body = functionBody(registerSql, "register_mercado_pago_webhook_delivery");
  assert.match(body, /on conflict\s*\(notification_id\)\s*do update/i);
  assert.match(body, /where current_event\.resource_id\s*=\s*excluded\.resource_id/i);
  assert.match(body, /delivery_count\s*=\s*current_event\.delivery_count\s*\+\s*1/i);
  assert.match(body, /if not found then\s*return/i);
});

test("claim bloqueia a linha e permite apenas uma reserva ativa por lease", () => {
  const body = functionBody(leaseSql, "claim_mercado_pago_webhook_event");
  assert.match(body, /for update/i);
  assert.match(body, /processing_token\s*=\s*p_processing_token/i);
  assert.match(body, /v_started_at\s*<=\s*now\(\)\s*-\s*interval\s+'5 minutes'/i);
  assert.match(body, /v_status in \('received', 'failed'\)/i);
});

test("finalização valida token e lease antes de alterar pedido ou evento", () => {
  const body = functionBody(leaseSql, "finalize_mercado_pago_webhook_event");
  assert.match(body, /where notification_id\s*=\s*p_notification_id\s+for update/i);
  assert.match(body, /processing_token is distinct from p_processing_token/i);
  assert.match(body, /processing_started_at\s*<=\s*now\(\)\s*-\s*interval\s+'5 minutes'/i);
  assert.ok(
    body.indexOf("public.cancel_unpaid_order_and_restore_stock") <
      body.indexOf("update public.mercado_pago_webhook_events"),
    "a alteração do pedido deve ocorrer antes da confirmação do evento na mesma função"
  );
  assert.match(body, /if not v_cancelled then return query select false, false, false/i);
  assert.match(body, /if v_rows = 0 then return query select false, false, false/i);
});

test("funções críticas não são executáveis por anon ou authenticated", () => {
  assert.match(leaseSql, /revoke all on function public\.claim_mercado_pago_webhook_event\(text, uuid\) from public, anon, authenticated/i);
  assert.match(leaseSql, /revoke all on function public\.finalize_mercado_pago_webhook_event\([\s\S]*?\) from public, anon, authenticated/i);
  assert.match(leaseSql, /grant execute on function public\.claim_mercado_pago_webhook_event\(text, uuid\) to service_role, postgres/i);
  assert.match(leaseSql, /grant execute on function public\.finalize_mercado_pago_webhook_event\([\s\S]*?\) to service_role, postgres/i);
});
