-- Exercises the recovery-token migration in the disposable PostgreSQL CI database only.
DO $$
DECLARE
  v_order_id uuid;
  v_retry_order_id uuid;
  v_legacy_order_id uuid := 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
  v_token_hash text := repeat('a', 64);
  v_other_token_hash text := repeat('b', 64);
  v_request_hash text := repeat('c', 64);
  v_failed boolean;
  v_saved_hash text;
BEGIN
  v_order_id := public.create_store_order_with_recovery_token(
    'Cliente teste', 'cliente@example.invalid', '92999990000', 'Endereço de teste',
    '[]'::jsonb, NULL, NULL,
    '123e4567-e89b-42d3-a456-426614174000', v_request_hash, v_token_hash
  );

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'new checkout did not return an order ID';
  END IF;

  SELECT token_hash INTO v_saved_hash
  FROM public.checkout_recovery_tokens
  WHERE order_id = v_order_id;

  IF v_saved_hash IS DISTINCT FROM v_token_hash THEN
    RAISE EXCEPTION 'recovery token hash was not persisted';
  END IF;

  v_retry_order_id := public.create_store_order_with_recovery_token(
    'Cliente teste', 'cliente@example.invalid', '92999990000', 'Endereço de teste',
    '[]'::jsonb, NULL, NULL,
    '123e4567-e89b-42d3-a456-426614174000', v_request_hash, v_token_hash
  );

  IF v_retry_order_id IS DISTINCT FROM v_order_id THEN
    RAISE EXCEPTION 'idempotent retry created a different order';
  END IF;

  v_failed := false;
  BEGIN
    PERFORM public.create_store_order_with_recovery_token(
      'Cliente teste', 'cliente@example.invalid', '92999990000', 'Endereço de teste',
      '[]'::jsonb, NULL, NULL,
      '123e4567-e89b-42d3-a456-426614174000', v_request_hash, v_other_token_hash
    );
  EXCEPTION WHEN raise_exception THEN
    v_failed := true;
  END;

  IF NOT v_failed THEN
    RAISE EXCEPTION 'a different token claimed an existing checkout attempt';
  END IF;

  SELECT token_hash INTO v_saved_hash
  FROM public.checkout_recovery_tokens
  WHERE order_id = v_order_id;

  IF v_saved_hash IS DISTINCT FROM v_token_hash THEN
    RAISE EXCEPTION 'token takeover changed the original recovery credential';
  END IF;

  -- A pre-existing order without a recovery token must fail closed.
  INSERT INTO public.orders (id, status, checkout_idempotency_key, checkout_request_hash)
  VALUES (
    v_legacy_order_id, 'aguardando',
    '123e4567-e89b-42d3-a456-426614174001', v_request_hash
  );

  v_failed := false;
  BEGIN
    PERFORM public.create_store_order_with_recovery_token(
      'Cliente legado', 'legado@example.invalid', '92999990001', 'Endereço legado',
      '[]'::jsonb, NULL, NULL,
      '123e4567-e89b-42d3-a456-426614174001', v_request_hash, v_token_hash
    );
  EXCEPTION WHEN raise_exception THEN
    v_failed := true;
  END;

  IF NOT v_failed THEN
    RAISE EXCEPTION 'a pre-existing order without a token was claimable';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.checkout_recovery_tokens WHERE order_id = v_legacy_order_id
  ) THEN
    RAISE EXCEPTION 'legacy order unexpectedly received a recovery token';
  END IF;

  IF NOT (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.checkout_recovery_tokens'::regclass
  ) THEN
    RAISE EXCEPTION 'recovery token table RLS is not enabled';
  END IF;

  IF has_table_privilege('anon', 'public.checkout_recovery_tokens', 'SELECT')
     OR has_table_privilege('authenticated', 'public.checkout_recovery_tokens', 'SELECT') THEN
    RAISE EXCEPTION 'public roles can read recovery token records';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.checkout_recovery_tokens', 'SELECT') THEN
    RAISE EXCEPTION 'service_role cannot read recovery token records';
  END IF;

  IF has_function_privilege(
       'anon',
       'public.create_store_order_with_recovery_token(text,text,text,text,jsonb,text,uuid,text,text,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.create_store_order_with_recovery_token(text,text,text,text,jsonb,text,uuid,text,text,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'public roles can execute the recovery-token RPC';
  END IF;

  IF NOT has_function_privilege(
    'service_role',
    'public.create_store_order_with_recovery_token(text,text,text,text,jsonb,text,uuid,text,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role cannot execute the recovery-token RPC';
  END IF;
END
$;

DELETE FROM public.checkout_recovery_tokens
WHERE order_id IN (
  'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'::uuid
)
OR order_id IN (
  SELECT id FROM public.orders
  WHERE checkout_idempotency_key = '123e4567-e89b-42d3-a456-426614174000'
);

DELETE FROM public.orders
WHERE id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
