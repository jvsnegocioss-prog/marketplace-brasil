-- Atomically register Mercado Pago webhook deliveries.
-- Repeated notification IDs increment delivery_count only when the resource matches.
-- A reused notification ID for a different resource returns no row.
create or replace function public.register_mercado_pago_webhook_delivery(
  p_notification_id text,
  p_resource_id text,
  p_request_id text,
  p_notification_type text,
  p_action text
)
returns table (resource_id text, processing_status text, delivery_count integer)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_resource_id text;
  v_processing_status text;
  v_delivery_count integer;
begin
  if p_notification_id is null
     or length(btrim(p_notification_id)) = 0
     or length(p_notification_id) > 200
     or p_resource_id is null
     or length(btrim(p_resource_id)) = 0
     or length(p_resource_id) > 500
     or p_request_id is null
     or length(btrim(p_request_id)) = 0
     or length(p_request_id) > 200 then
    raise exception 'Invalid webhook delivery identifiers'
      using errcode = '22023';
  end if;

  insert into public.mercado_pago_webhook_events as current_event (
    notification_id, resource_id, request_id, notification_type, action,
    processing_status, delivery_count, received_at, last_received_at
  )
  values (
    p_notification_id, p_resource_id, p_request_id,
    left(p_notification_type, 100), left(p_action, 100),
    'received', 1, now(), now()
  )
  on conflict (notification_id) do update
    set request_id = excluded.request_id,
        notification_type = coalesce(excluded.notification_type, current_event.notification_type),
        action = coalesce(excluded.action, current_event.action),
        delivery_count = current_event.delivery_count + 1,
        last_received_at = now()
    where current_event.resource_id = excluded.resource_id
  returning current_event.resource_id,
            current_event.processing_status,
            current_event.delivery_count
  into v_resource_id, v_processing_status, v_delivery_count;

  if not found then
    return;
  end if;

  return query select v_resource_id, v_processing_status, v_delivery_count;
end;
$function$;

revoke all on function public.register_mercado_pago_webhook_delivery(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.register_mercado_pago_webhook_delivery(text, text, text, text, text)
  to service_role;
