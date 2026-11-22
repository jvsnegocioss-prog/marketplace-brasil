\\set ON_ERROR_STOP on
-- Disposable PostgreSQL only. This test never connects to Supabase.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

CREATE TABLE public.mercado_pago_webhook_events (
  notification_id text PRIMARY KEY,
  processing_status text NOT NULL,
  CONSTRAINT mercado_pago_webhook_events_processing_status_check
    CHECK (processing_status = ANY (ARRAY['received','processing','processed','failed','ignored']))
);

CREATE TABLE public.products (
  id uuid PRIMARY KEY,
  stock integer NOT NULL DEFAULT 0
);
CREATE TABLE public.discount_coupons (
  id uuid PRIMARY KEY,
  usage_count integer NOT NULL DEFAULT 0
);
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'aguardando',
  coupon_id uuid REFERENCES public.discount_coupons(id),
  checkout_idempotency_key text UNIQUE,
  checkout_request_hash text,
  customer_user_id uuid
);
CREATE TABLE public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id),
  product_id uuid REFERENCES public.products(id),
  quantity integer NOT NULL DEFAULT 1
);

CREATE FUNCTION public.create_store_order_with_coupon_and_delivery(
  text, text, text, text, jsonb, text, uuid
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.orders(status) VALUES ('aguardando') RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

\\ir ../migrations/20261121010000_checkout_stock_recovery_and_customer_binding.sql

DO $$
DECLARE
  v_order uuid;
  v_again uuid;
  v_hash text := repeat('a',64);
  v_user uuid := '00000000-0000-0000-0000-000000000011';
BEGIN
  v_order := public.create_store_order_with_coupon_and_delivery_for_customer(
    'Cliente Teste','teste@example.invalid','92999999999','Rua Teste',
    '[]'::jsonb,NULL,NULL,
    '00000000-0000-0000-0000-000000000101',v_hash,v_user
  );
  v_again := public.create_store_order_with_coupon_and_delivery_for_customer(
    'Cliente Teste','teste@example.invalid','92999999999','Rua Teste',
    '[]'::jsonb,NULL,NULL,
    '00000000-0000-0000-0000-000000000101',v_hash,v_user
  );
  IF v_order IS DISTINCT FROM v_again THEN
    RAISE EXCEPTION 'Idempotency did not return the original order';
  END IF;
  IF (SELECT customer_user_id FROM public.orders WHERE id=v_order) IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'Authenticated customer was not bound to the order';
  END IF;

  BEGIN
    PERFORM public.create_store_order_with_coupon_and_delivery_for_customer(
      'Outro Cliente','outro@example.invalid','92988888888','Rua Teste',
      '[]'::jsonb,NULL,NULL,
      '00000000-0000-0000-0000-000000000101',v_hash,
      '00000000-0000-0000-0000-000000000012'
    );
    RAISE EXCEPTION 'Idempotency key was reused by another customer';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Idempotency key was reused by another customer' THEN RAISE; END IF;
    IF SQLERRM <> 'Esta chave já foi utilizada com dados ou titular diferentes' THEN RAISE; END IF;
  END;
END;
$$;

INSERT INTO public.products(id,stock)
VALUES ('00000000-0000-0000-0000-000000000201',10);
INSERT INTO public.discount_coupons(id,usage_count)
VALUES ('00000000-0000-0000-0000-000000000301',1);
INSERT INTO public.orders(id,status,coupon_id)
VALUES ('00000000-0000-0000-0000-000000000401','aguardando',
        '00000000-0000-0000-0000-000000000301');
INSERT INTO public.order_items(order_id,product_id,quantity)
VALUES ('00000000-0000-0000-0000-000000000401',
        '00000000-0000-0000-0000-000000000201',2);

DO $$
DECLARE v_result jsonb;
BEGIN
  v_result := public.cancel_unpaid_order_and_restore_stock(
    '00000000-0000-0000-0000-000000000401'
  );
  IF v_result->>'outcome' <> 'cancelled' THEN
    RAISE EXCEPTION 'Expected cancelled, got %',v_result;
  END IF;
  IF (SELECT stock FROM public.products WHERE id='00000000-0000-0000-0000-000000000201') <> 12 THEN
    RAISE EXCEPTION 'Stock was not restored exactly once';
  END IF;
  IF (SELECT usage_count FROM public.discount_coupons WHERE id='00000000-0000-0000-0000-000000000301') <> 0 THEN
    RAISE EXCEPTION 'Coupon usage was not reversed';
  END IF;
  IF (SELECT status FROM public.orders WHERE id='00000000-0000-0000-0000-000000000401') <> 'Cancelado' THEN
    RAISE EXCEPTION 'Order status was not cancelled';
  END IF;
  v_result := public.cancel_unpaid_order_and_restore_stock(
    '00000000-0000-0000-0000-000000000401'
  );
  IF v_result->>'outcome' <> 'already_restored' THEN
    RAISE EXCEPTION 'Second cancellation was not idempotent: %',v_result;
  END IF;
  IF (SELECT stock FROM public.products WHERE id='00000000-0000-0000-0000-000000000201') <> 12 THEN
    RAISE EXCEPTION 'Stock was restored twice';
  END IF;
END;
$$;

INSERT INTO public.orders(id,status)
VALUES ('00000000-0000-0000-0000-000000000402','Pago');
INSERT INTO public.order_items(order_id,product_id,quantity)
VALUES ('00000000-0000-0000-0000-000000000402',
        '00000000-0000-0000-0000-000000000201',3);

DO $$
DECLARE v_result jsonb;
BEGIN
  v_result := public.cancel_unpaid_order_and_restore_stock(
    '00000000-0000-0000-0000-000000000402'
  );
  IF v_result->>'outcome' <> 'not_eligible' THEN
    RAISE EXCEPTION 'Paid order was incorrectly eligible: %',v_result;
  END IF;
  IF (SELECT stock FROM public.products WHERE id='00000000-0000-0000-0000-000000000201') <> 12 THEN
    RAISE EXCEPTION 'Paid order stock was incorrectly restored';
  END IF;
END;
$$;

INSERT INTO public.orders(id,status)
VALUES ('00000000-0000-0000-0000-000000000403','Cancelado');
DO $$
DECLARE v_result jsonb;
BEGIN
  v_result := public.cancel_unpaid_order_and_restore_stock(
    '00000000-0000-0000-0000-000000000403'
  );
  IF v_result->>'outcome' <> 'cancelled_unverified' THEN
    RAISE EXCEPTION 'Legacy cancellation should require reconciliation: %',v_result;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT has_function_privilege('service_role',
    'public.cancel_unpaid_order_and_restore_stock(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'service_role missing cancel RPC execute';
  END IF;
  IF has_function_privilege('anon',
    'public.cancel_unpaid_order_and_restore_stock(uuid)','EXECUTE')
     OR has_function_privilege('authenticated',
    'public.cancel_unpaid_order_and_restore_stock(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'Browser role can execute privileged cancel RPC';
  END IF;
  IF NOT has_table_privilege('anon','public.order_stock_restorations','SELECT') = false THEN
    RAISE EXCEPTION 'Anonymous role unexpectedly reads restoration ledger';
  END IF;
END;
$$;

\\echo 'PASS: migration applies; customer binding and idempotency; atomic stock/coupon restoration; no double restore; paid and legacy cancellation guards; RPC grants.'
