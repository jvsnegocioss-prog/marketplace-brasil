\set ON_ERROR_STOP on
\ir ../../supabase/migrations/20261115031720_create_mercado_pago_webhook_event_ledger.sql
\ir ../../supabase/migrations/20261115225848_register_mercado_pago_webhook_delivery.sql
\ir ../../supabase/migrations/20261115234248_protect_mercado_pago_webhook_processing_leases.sql

do $$
declare
  v_row record;
  v_count integer;
  v_order uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_token_a uuid := '11111111-1111-4111-8111-111111111111';
  v_token_b uuid := '22222222-2222-4222-8222-222222222222';
  v_order_race uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
begin
  select * into v_row from public.register_mercado_pago_webhook_delivery(
    'integration-duplicate', 'mp-order-1', 'req-1', 'order', 'created'
  );
  if v_row.delivery_count <> 1 or v_row.processing_status <> 'received' then
    raise exception 'first delivery was not registered correctly';
  end if;

  select * into v_row from public.register_mercado_pago_webhook_delivery(
    'integration-duplicate', 'mp-order-1', 'req-2', 'order', 'updated'
  );
  if v_row.delivery_count <> 2 then raise exception 'duplicate delivery was not counted'; end if;

  select count(*) into v_count from public.register_mercado_pago_webhook_delivery(
    'integration-duplicate', 'different-resource', 'req-3', 'order', 'updated'
  );
  if v_count <> 0 then raise exception 'notification/resource mismatch was accepted'; end if;

  select * into v_row from public.claim_mercado_pago_webhook_event('integration-duplicate', v_token_a);
  if not v_row.claimed then raise exception 'first claim failed'; end if;

  select * into v_row from public.claim_mercado_pago_webhook_event('integration-duplicate', v_token_b);
  if v_row.claimed then raise exception 'second active claim was accepted'; end if;

  update public.mercado_pago_webhook_events
     set processing_started_at = now() - interval '6 minutes'
   where notification_id = 'integration-duplicate';

  select * into v_row from public.claim_mercado_pago_webhook_event('integration-duplicate', v_token_b);
  if not v_row.claimed then raise exception 'expired lease was not reclaimed'; end if;

  insert into public.orders(id, status) values (v_order, 'aguardando');
  select * into v_row from public.finalize_mercado_pago_webhook_event(
    'integration-duplicate', v_token_a, 'processed', null, v_order,
    'set_status', 'pago', array['aguardando']::text[]
  );
  if v_row.finalized then raise exception 'stale token finalized a reclaimed event'; end if;

  select * into v_row from public.finalize_mercado_pago_webhook_event(
    'integration-duplicate', v_token_b, 'processed', null, v_order,
    'set_status', 'pago', array['aguardando']::text[]
  );
  if not v_row.finalized or not v_row.order_updated then
    raise exception 'valid lease did not finalize the order';
  end if;

  if (select status from public.orders where id = v_order) <> 'pago' then
    raise exception 'order status was not updated';
  end if;

  insert into public.orders(id, status) values (v_order_race, 'aguardando');
  perform public.register_mercado_pago_webhook_delivery('race-webhook', 'mp-race-1', 'req-race-1', 'order', 'updated');
  perform public.register_mercado_pago_webhook_delivery('race-reconciler', 'mp-race-2', 'req-race-2', 'order', 'updated');
  select * into v_row from public.claim_mercado_pago_webhook_event('race-webhook', '55555555-5555-4555-8555-555555555555');
  if not v_row.claimed then raise exception 'webhook race event claim failed'; end if;
  select * into v_row from public.claim_mercado_pago_webhook_event('race-reconciler', '66666666-6666-4666-8666-666666666666');
  if not v_row.claimed then raise exception 'reconciler race event claim failed'; end if;
end
$$;

select 'postgres integration assertions passed' as result;
