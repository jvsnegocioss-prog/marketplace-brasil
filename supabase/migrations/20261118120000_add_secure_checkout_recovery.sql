-- Secure checkout recovery. Review-only migration; do not apply without separate approval.
CREATE TABLE IF NOT EXISTS public.checkout_recovery_tokens (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  token_hash text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS checkout_recovery_tokens_token_hash_uidx
  ON public.checkout_recovery_tokens (token_hash);

ALTER TABLE public.checkout_recovery_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.checkout_recovery_tokens FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.checkout_recovery_tokens TO service_role;

CREATE OR REPLACE FUNCTION public.create_store_order_with_recovery_token(
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_delivery_address text,
  p_items jsonb,
  p_coupon_code text,
  p_delivery_neighborhood_id uuid,
  p_checkout_idempotency_key text,
  p_checkout_request_hash text,
  p_checkout_recovery_token_hash text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $recovery_body$
DECLARE
  v_order_id uuid;
  v_existing_order_id uuid;
  v_existing_order boolean := false;
  v_saved_token_hash text;
BEGIN
  IF p_checkout_recovery_token_hash IS NULL
     OR p_checkout_recovery_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Token de recuperação inválido';
  END IF;

  IF p_checkout_idempotency_key IS NULL
     OR p_checkout_idempotency_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Chave de idempotência inválida';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_checkout_idempotency_key, 0));

  SELECT id INTO v_existing_order_id
  FROM public.orders
  WHERE checkout_idempotency_key = p_checkout_idempotency_key;
  v_existing_order := FOUND;

  IF v_existing_order THEN
    SELECT token_hash INTO v_saved_token_hash
    FROM public.checkout_recovery_tokens
    WHERE order_id = v_existing_order_id;

    -- Never let a caller claim a pre-existing order by supplying a new token.
    IF NOT FOUND OR v_saved_token_hash IS DISTINCT FROM lower(p_checkout_recovery_token_hash) THEN
      RAISE EXCEPTION 'Esta tentativa não possui uma credencial de recuperação correspondente';
    END IF;
  END IF;

  v_order_id := public.create_store_order_with_coupon_and_delivery(
    p_customer_name,
    p_customer_email,
    p_customer_phone,
    p_delivery_address,
    p_items,
    p_coupon_code,
    p_delivery_neighborhood_id,
    p_checkout_idempotency_key,
    p_checkout_request_hash
  );

  IF NOT v_existing_order THEN
    INSERT INTO public.checkout_recovery_tokens (order_id, token_hash, expires_at)
    VALUES (v_order_id, lower(p_checkout_recovery_token_hash), now() + interval '7 days');
  END IF;

  RETURN v_order_id;
END;
$recovery_body$;

REVOKE ALL ON FUNCTION public.create_store_order_with_recovery_token(
  text, text, text, text, jsonb, text, uuid, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_store_order_with_recovery_token(
  text, text, text, text, jsonb, text, uuid, text, text, text
) TO service_role;
