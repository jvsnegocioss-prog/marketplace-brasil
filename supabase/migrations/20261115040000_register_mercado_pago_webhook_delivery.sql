-- Atomically register each signed Mercado Pago webhook delivery.
-- A repeated notification increments delivery_count only when its resource_id matches.
create or replace function public.register_mercado_pago_webhook_delivery(
  p_notification_id text,
  p_resource_id text,
  p_request_id text,
  p_notification_type text,
  p_action text
)
returns table (
  resource_id text,
  processing_status text,
  delivery_count integer
)
language sql
security definer
set search_path = ''
as $$
  insert into public.mercado_pago_webhook_events as existing (
    notification_id,
    resource_id,
    request_id,
    notification_type,
    action
  )
  values (
    p_notification_id,
    p_resource_id,
    p_request_id,
    p_notification_type,
    p_action
  )
  on conflict (notification_id) do update
    set delivery_count = existing.delivery_count + 1,
        last_received_at = now(),
        request_id = excluded.request_id
    where existing.resource_id = excluded.resource_id
  returning
    existing.resource_id,
    existing.processing_status,
    existing.delivery_count;
$$;

revoke all on function public.register_mercado_pago_webhook_delivery(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.register_mercado_pago_webhook_delivery(text, text, text, text, text)
  to service_role;
