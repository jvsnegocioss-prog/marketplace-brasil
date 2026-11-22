-- Draft only: review and apply in a controlled test environment before production.
-- Adds an atomic cancellation routine and a customer-aware idempotent checkout RPC.

CREATE OR REPLACE FUNCTION public.create_store_order_with_coupon_and_delivery_for_customer(
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_delivery_address text,
  p_items jsonb,
  p_coupon_code text,
  p_delivery_neighborhood_id uuid,
  p_checkout_idempotency_key text,
  p_checkout_request_hash text,
  p_customer_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_existing_order_id uuid;
  v_existing_hash text;
  v_existing_customer_id uuid;
  v_order_id uuid;
BEGIN
  IF p_checkout_idempotency_key IS NULL
     OR p_checkout_idempotency_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Chave de idempotência inválida';
  END IF;

  IF p_checkout_request_hash IS NULL
     OR p_checkout_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Identificador da solicitação inválido';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_checkout_idempotency_key, 0)
  );

  SELECT o.id, o.checkout_request_hash, o.customer_user_id
    INTO v_existing_order_id, v_existing_hash, v_existing_customer_id
  FROM public.orders AS o
  WHERE o.checkout_idempotency_key = p_checkout_idempotency_key;

  IF FOUND THEN
    IF v_existing_hash IS DISTINCT FROM p_checkout_request_hash
       OR v_existing_customer_id IS DISTINCT FROM p_customer_user_id THEN
      RAISE EXCEPTION 'Esta chave já foi utilizada com dados ou titular diferentes';
    END IF;
    RETURN v_existing_order_id;
  END IF;

  v_order_id := public.create_store_order_with_coupon_and_delivery(
    p_customer_name,
    p_customer_email,
    p_customer_phone,
    p_delivery_address,
    p_items,
    p_coupon_code,
    p_delivery_neighborhood_id
  );

  UPDATE public.orders
     SET checkout_idempotency_key = p_checkout_idempotency_key,
         checkout_request_hash = p_checkout_request_hash,
         customer_user_id = p_customer_user_id
   WHERE id = v_order_id;

  RETURN v_order_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_store_order_with_coupon_and_delivery_for_customer(
  text, text, text, text, jsonb, text, uuid, text, text, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_store_order_with_coupon_and_delivery_for_customer(
  text, text, text, text, jsonb, text, uuid, text, text, uuid
) TO service_role;


-- Internal ledger: proves stock and coupon reversal committed exactly once.
CREATE TABLE IF NOT EXISTS public.order_stock_restorations (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE RESTRICT,
  restored_at timestamptz NOT NULL DEFAULT now(),
  product_lines jsonb NOT NULL,
  coupon_id uuid
);

ALTER TABLE public.order_stock_restorations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.order_stock_restorations FROM PUBLIC, anon, authenticated;

-- Production currently has this exact signature returning boolean.
-- PostgreSQL cannot change a function's return type with CREATE OR REPLACE;
-- drop the old signature in this migration transaction before recreating it
-- with the JSONB outcome contract consumed by the updated API route.
DROP FUNCTION IF EXISTS public.cancel_unpaid_order_and_restore_stock(uuid);

CREATE OR REPLACE FUNCTION public.cancel_unpaid_order_and_restore_stock(
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_item record;
  v_item_count integer := 0;
  v_updated_count integer := 0;
  v_product_lines jsonb := '[]'::jsonb;
BEGIN
  SELECT *
    INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'not_found');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.order_stock_restorations AS r
    WHERE r.order_id = p_order_id
  ) THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'already_restored');
  END IF;

  IF pg_catalog.lower(pg_catalog.btrim(v_order.status)) IN
     ('cancelado', 'cancelada', 'canceled', 'cancelled') THEN
    -- Legacy/manual cancellation without proof of stock restoration:
    -- never guess whether inventory was already returned.
    RETURN pg_catalog.jsonb_build_object('outcome', 'cancelled_unverified');
  END IF;

  IF pg_catalog.lower(pg_catalog.btrim(v_order.status)) <> 'aguardando' THEN
    RETURN pg_catalog.jsonb_build_object(
      'outcome', 'not_eligible',
      'current_status', v_order.status
    );
  END IF;

  FOR v_item IN
    SELECT oi.product_id, pg_catalog.sum(oi.quantity)::integer AS quantity
    FROM public.order_items AS oi
    WHERE oi.order_id = p_order_id
    GROUP BY oi.product_id
    ORDER BY oi.product_id
  LOOP
    v_item_count := v_item_count + 1;

    IF v_item.quantity IS NULL OR v_item.quantity <= 0 THEN
      RAISE EXCEPTION 'Não é possível restaurar o estoque: quantidade inválida';
    END IF;

    IF v_item.product_id IS NULL THEN
      RAISE EXCEPTION 'Não é possível restaurar o estoque: item sem vínculo com produto';
    END IF;

    PERFORM 1
    FROM public.products AS p
    WHERE p.id = v_item.product_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Não é possível restaurar o estoque: produto % não encontrado',
        v_item.product_id;
    END IF;

    UPDATE public.products
       SET stock = stock + v_item.quantity
     WHERE id = v_item.product_id;

    v_product_lines := v_product_lines || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'product_id', v_item.product_id,
        'quantity', v_item.quantity
      )
    );
  END LOOP;

  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'Não é possível cancelar pedido sem itens vinculados';
  END IF;

  IF v_order.coupon_id IS NOT NULL THEN
    UPDATE public.discount_coupons
       SET usage_count = usage_count - 1
     WHERE id = v_order.coupon_id
       AND usage_count > 0;

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count <> 1 THEN
      RAISE EXCEPTION 'Não foi possível reverter o uso do cupom do pedido';
    END IF;
  END IF;

  UPDATE public.orders
     SET status = 'Cancelado'
   WHERE id = p_order_id
     AND status = 'aguardando';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count <> 1 THEN
    RAISE EXCEPTION 'O pedido mudou de estado durante o cancelamento';
  END IF;

  INSERT INTO public.order_stock_restorations (
    order_id, product_lines, coupon_id
  ) VALUES (
    p_order_id, v_product_lines, v_order.coupon_id
  );

  RETURN pg_catalog.jsonb_build_object('outcome', 'cancelled');
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_unpaid_order_and_restore_stock(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_unpaid_order_and_restore_stock(uuid)
  TO service_role;
