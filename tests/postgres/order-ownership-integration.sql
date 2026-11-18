-- Verifies the authenticated order ownership migration on disposable PostgreSQL only.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders'
      AND column_name = 'customer_user_id' AND data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'orders.customer_user_id migration missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'orders_customer_user_id_created_at_idx'
  ) THEN
    RAISE EXCEPTION 'customer ownership index missing';
  END IF;
END
$$;

INSERT INTO auth.users (id)
VALUES ('77777777-7777-4777-8777-777777777777')
ON CONFLICT DO NOTHING;

INSERT INTO public.orders (id, status, customer_user_id)
VALUES ('88888888-8888-4888-8888-888888888888', 'aguardando', '77777777-7777-4777-8777-777777777777');

DO $$
BEGIN
  IF (SELECT customer_user_id FROM public.orders
      WHERE id = '88888888-8888-4888-8888-888888888888')
     <> '77777777-7777-4777-8777-777777777777'::uuid THEN
    RAISE EXCEPTION 'authenticated order ownership not persisted';
  END IF;

  BEGIN
    INSERT INTO public.orders (id, status, customer_user_id)
    VALUES ('99999999-9999-4999-8999-999999999999', 'aguardando',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    RAISE EXCEPTION 'invalid auth user reference was accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
END
$$;

DELETE FROM public.orders WHERE id = '88888888-8888-4888-8888-888888888888';
DELETE FROM auth.users WHERE id = '77777777-7777-4777-8777-777777777777';
