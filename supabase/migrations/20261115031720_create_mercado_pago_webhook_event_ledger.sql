-- Audit ledger for signed Mercado Pago webhook deliveries.
-- RLS is enabled and direct access is restricted to the server service role.
create table if not exists public.mercado_pago_webhook_events (
  notification_id text primary key,
  resource_id text not null,
  request_id text,
  notification_type text,
  action text,
  processing_status text not null default 'received'
    check (processing_status in ('received', 'processing', 'processed', 'failed', 'ignored')),
  delivery_count integer not null default 1 check (delivery_count > 0),
  received_at timestamptz not null default now(),
  last_received_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error_code text,
  constraint mercado_pago_webhook_events_notification_id_nonempty
    check (length(btrim(notification_id)) > 0),
  constraint mercado_pago_webhook_events_resource_id_nonempty
    check (length(btrim(resource_id)) > 0)
);

alter table public.mercado_pago_webhook_events enable row level security;
revoke all on table public.mercado_pago_webhook_events from public, anon, authenticated;
grant select, insert, update on table public.mercado_pago_webhook_events to service_role;

create index if not exists mercado_pago_webhook_events_resource_id_idx
  on public.mercado_pago_webhook_events (resource_id);
create index if not exists mercado_pago_webhook_events_status_received_idx
  on public.mercado_pago_webhook_events (processing_status, received_at);
