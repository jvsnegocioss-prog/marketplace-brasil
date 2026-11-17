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
const hardeningSql = fs.readFileSync(
  path.join(migrationDir, "20261117033138_harden_mercado_pago_webhook_finalization.sql"),
  "utf8"
);
const webhookRoute = fs.readFileSync(
  path.join(__dirname, "..", "app", "api", "mercadopago", "webhook", "route.ts"),
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

test("migration de endurecimento rejeita parâmetros nulos e status update sem allowlist", () => {
  const body = functionBody(hardeningSql, "finalize_mercado_pago_webhook_event");
  assert.match(body, /p_notification_id is null/i);
  assert.match(body, /p_processing_token is null/i);
  assert.match(body, /p_final_status is null/i);
  assert.match(body, /p_order_action is null/i);
  assert.match(body, /p_allowed_current_statuses is null/i);
  assert.match(body, /cardinality\(p_allowed_current_statuses\) = 0/i);
  assert.match(body, /allowed_status is null or length\(btrim\(allowed_status\)\) = 0/i);
  assert.doesNotMatch(body, /if p_allowed_current_statuses is null then\s*update public\.orders/i);
  assert.match(body, /lower\(trim\(status\)\) = any/i);
});

test("funções críticas não são executáveis por anon ou authenticated", () => {
  assert.match(leaseSql, /revoke all on function public\.claim_mercado_pago_webhook_event\(text, uuid\) from public, anon, authenticated/i);
  assert.match(hardeningSql, /revoke all on function public\.finalize_mercado_pago_webhook_event\([\s\S]*?\) from public, anon, authenticated/i);
  assert.match(leaseSql, /grant execute on function public\.claim_mercado_pago_webhook_event\(text, uuid\) to service_role, postgres/i);
  assert.match(hardeningSql, /grant execute on function public\.finalize_mercado_pago_webhook_event\([\s\S]*?\) to service_role, postgres/i);
});

test("atualizações de revisão e chargeback usam compare-and-set do status observado", () => {
  assert.match(
    webhookRoute,
    /payment_state_requires_manual_review",\s*"set_status",\s*orderId,\s*"Revisão necessária",\s*\[storeOrder\.status\]\)/
  );
  assert.match(
    webhookRoute,
    /chargeback_requires_manual_review",\s*"set_status",\s*orderId,\s*"Em contestação",\s*\[storeOrder\.status\]\)/
  );
});
