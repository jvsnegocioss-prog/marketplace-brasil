-- Atomically claim and finalize Mercado Pago webhook deliveries.
alter table public.mercado_pago_webhook_events
  add column if not exists processing_token uuid,
  add column if not exists processing_started_at timestamptz;

create or replace function public.register_mercado_pago_webhook_delivery(
  p_notification_id text, p_resource_id text, p_request_id text,
  p_notification_type text, p_action text
)
returns table(resource_id text, processing_status text, delivery_count integer)
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_resource_id text; v_processing_status text; v_delivery_count integer;
begin
  if p_notification_id is null or length(btrim(p_notification_id)) = 0 or length(p_notification_id) > 200
     or p_resource_id is null or length(btrim(p_resource_id)) = 0 or length(p_resource_id) > 500
     or p_request_id is null or length(btrim(p_request_id)) = 0 or length(p_request_id) > 200 then
    raise exception 'Invalid webhook delivery identifiers' using errcode = '22023';
  end if;
  insert into public.mercado_pago_webhook_events as current_event (
    notification_id, resource_id, request_id, notification_type, action,
    processing_status, delivery_count, received_at, last_received_at
  ) values (
    p_notification_id, p_resource_id, p_request_id,
    left(p_notification_type, 100), left(p_action, 100), 'received', 1, now(), now()
  )
  on conflict (notification_id) do update
    set request_id = excluded.request_id,
        notification_type = coalesce(excluded.notification_type, current_event.notification_type),
        action = coalesce(excluded.action, current_event.action),
        delivery_count = current_event.delivery_count + 1
    where current_event.resource_id = excluded.resource_id
  returning current_event.resource_id, current_event.processing_status, current_event.delivery_count
  into v_resource_id, v_processing_status, v_delivery_count;
  if not found then return; end if;
  return query select v_resource_id, v_processing_status, v_delivery_count;
end;
$$;

create or replace function public.claim_mercado_pago_webhook_event(p_notification_id text, p_processing_token uuid)
returns table(claimed boolean, processing_status text)
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_status text; v_started_at timestamptz;
begin
  if p_notification_id is null or length(btrim(p_notification_id)) = 0 or p_processing_token is null then
    raise exception 'Invalid webhook claim parameters' using errcode = '22023';
  end if;
  select e.processing_status, e.processing_started_at into v_status, v_started_at
  from public.mercado_pago_webhook_events e where e.notification_id = p_notification_id for update;
  if not found then return query select false, null::text; return; end if;
  if v_status in ('received', 'failed')
     or (v_status = 'processing' and v_started_at is not null
         and v_started_at <= now() - interval '5 minutes') then
    update public.mercado_pago_webhook_events
       set processing_status = 'processing', processing_token = p_processing_token,
           processing_started_at = now(), last_received_at = now(),
           processed_at = null, last_error_code = null
     where notification_id = p_notification_id;
    return query select true, 'processing'::text; return;
  end if;
  return query select false, v_status;
end;
$$;

create or replace function public.finalize_mercado_pago_webhook_event(
  p_notification_id text, p_processing_token uuid, p_final_status text,
  p_error_code text default null, p_order_id uuid default null,
  p_order_action text default 'none', p_order_status text default null,
  p_allowed_current_statuses text[] default null
)
returns table(finalized boolean, order_updated boolean, order_cancelled boolean)
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_event public.mercado_pago_webhook_events%rowtype; v_rows integer := 0; v_cancelled boolean := false;
begin
  if p_final_status not in ('processed', 'ignored', 'failed')
     or p_order_action not in ('none', 'set_status', 'cancel_unpaid') then
    raise exception 'Invalid webhook finalization parameters' using errcode = '22023';
  end if;
  select * into v_event from public.mercado_pago_webhook_events
   where notification_id = p_notification_id for update;
  if not found or v_event.processing_status <> 'processing'
     or v_event.processing_token is distinct from p_processing_token
     or v_event.processing_started_at is null
     or v_event.processing_started_at <= now() - interval '5 minutes' then
    return query select false, false, false; return;
  end if;

  if p_order_action = 'cancel_unpaid' then
    if p_order_id is null then raise exception 'Order ID required for unpaid cancellation' using errcode = '22023'; end if;
    v_cancelled := public.cancel_unpaid_order_and_restore_stock(p_order_id);
    if not v_cancelled then return query select false, false, false; return; end if;
  elsif p_order_action = 'set_status' then
    if p_order_id is null or p_order_status is null then
      raise exception 'Order ID and status required for status update' using errcode = '22023';
    end if;
    if p_allowed_current_statuses is null then
      update public.orders set status = p_order_status where id = p_order_id;
    else
      update public.orders set status = p_order_status
       where id = p_order_id
         and lower(trim(status)) = any (
           select lower(trim(s)) from unnest(p_allowed_current_statuses) as s
         );
    end if;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then return query select false, false, false; return; end if;
  end if;

  update public.mercado_pago_webhook_events
     set processing_status = p_final_status,
         processed_at = case when p_final_status = 'processed' then now() else null end,
         last_error_code = p_error_code, processing_token = null, processing_started_at = null
   where notification_id = p_notification_id;
  return query select true, v_rows > 0, v_cancelled;
end;
$$;

revoke all on function public.claim_mercado_pago_webhook_event(text, uuid) from public, anon, authenticated;
revoke all on function public.finalize_mercado_pago_webhook_event(text, uuid, text, text, uuid, text, text, text[]) from public, anon, authenticated;
grant execute on function public.claim_mercado_pago_webhook_event(text, uuid) to service_role, postgres;
grant execute on function public.finalize_mercado_pago_webhook_event(text, uuid, text, text, uuid, text, text, text[]) to service_role, postgres;
revoke all on function public.register_mercado_pago_webhook_delivery(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.register_mercado_pago_webhook_delivery(text, text, text, text, text) to service_role, postgres;
