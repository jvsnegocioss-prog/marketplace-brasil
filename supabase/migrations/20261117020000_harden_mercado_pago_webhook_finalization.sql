-- Reject NULL/blank finalization inputs and require an explicit compare-and-set
-- allowlist for every status update performed by the Mercado Pago webhook ledger.
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
declare
  v_event public.mercado_pago_webhook_events%rowtype;
  v_rows integer := 0;
  v_cancelled boolean := false;
begin
  if p_notification_id is null
     or length(btrim(p_notification_id)) = 0
     or p_processing_token is null
     or p_final_status is null
     or p_final_status not in ('processed', 'ignored', 'failed')
     or p_order_action is null
     or p_order_action not in ('none', 'set_status', 'cancel_unpaid') then
    raise exception 'Invalid webhook finalization parameters' using errcode = '22023';
  end if;

  if p_order_action = 'set_status' then
    if p_order_id is null
       or p_order_status is null
       or length(btrim(p_order_status)) = 0
       or p_allowed_current_statuses is null
       or cardinality(p_allowed_current_statuses) = 0
       or exists (
         select 1
         from unnest(p_allowed_current_statuses) as allowed_status
         where allowed_status is null or length(btrim(allowed_status)) = 0
       ) then
      raise exception 'Status update requires an order, target status, and non-empty allowed current statuses'
        using errcode = '22023';
    end if;
  elsif p_order_action = 'cancel_unpaid' then
    if p_order_id is null then
      raise exception 'Order ID required for unpaid cancellation' using errcode = '22023';
    end if;
  end if;

  select * into v_event
  from public.mercado_pago_webhook_events
  where notification_id = p_notification_id
  for update;

  if not found
     or v_event.processing_status <> 'processing'
     or v_event.processing_token is distinct from p_processing_token
     or v_event.processing_started_at is null
     or v_event.processing_started_at <= now() - interval '5 minutes' then
    return query select false, false, false;
    return;
  end if;

  if p_order_action = 'cancel_unpaid' then
    v_cancelled := public.cancel_unpaid_order_and_restore_stock(p_order_id);
    if not v_cancelled then
      return query select false, false, false;
      return;
    end if;
  elsif p_order_action = 'set_status' then
    update public.orders
       set status = p_order_status
     where id = p_order_id
       and lower(trim(status)) = any (
         select lower(trim(allowed_status))
         from unnest(p_allowed_current_statuses) as allowed_status
       );
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      return query select false, false, false;
      return;
    end if;
  end if;

  update public.mercado_pago_webhook_events
     set processing_status = p_final_status,
         processed_at = case when p_final_status = 'processed' then now() else null end,
         last_error_code = p_error_code,
         processing_token = null,
         processing_started_at = null
   where notification_id = p_notification_id;

  return query select true, v_rows > 0, v_cancelled;
end;
$$;

revoke all on function public.finalize_mercado_pago_webhook_event(text, uuid, text, text, uuid, text, text, text[]) from public, anon, authenticated;
grant execute on function public.finalize_mercado_pago_webhook_event(text, uuid, text, text, uuid, text, text, text[]) to service_role, postgres;