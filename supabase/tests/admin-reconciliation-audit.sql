\set ON_ERROR_STOP on
-- Disposable PostgreSQL test only. Never point this script at production.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

CREATE TABLE public.mercado_pago_webhook_events (
  notification_id text PRIMARY KEY,
  resource_id text NOT NULL,
  processing_status text NOT NULL
);
INSERT INTO public.mercado_pago_webhook_events
  (notification_id, resource_id, processing_status)
VALUES ('test-notification-1', 'test-resource-1', 'reconciliation_required');

\ir ../../docs/sql-drafts/admin-reconciliation-audit.draft.sql

DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.mercado_pago_reconciliation_audit'::regclass) THEN
    RAISE EXCEPTION 'RLS must be enabled';
  END IF;
  IF has_table_privilege('anon', 'public.mercado_pago_reconciliation_audit', 'SELECT')
     OR has_table_privilege('anon', 'public.mercado_pago_reconciliation_audit', 'INSERT')
     OR has_table_privilege('authenticated', 'public.mercado_pago_reconciliation_audit', 'SELECT')
     OR has_table_privilege('authenticated', 'public.mercado_pago_reconciliation_audit', 'INSERT') THEN
    RAISE EXCEPTION 'Browser roles unexpectedly have table access';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.mercado_pago_reconciliation_audit', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.mercado_pago_reconciliation_audit', 'INSERT') THEN
    RAISE EXCEPTION 'service_role is missing required table privileges';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.prevent_reconciliation_audit_mutation()', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role is missing trigger function EXECUTE';
  END IF;
END;
$$;

SET ROLE service_role;
INSERT INTO public.mercado_pago_reconciliation_audit
  (notification_id, resource_id, order_id, admin_user_id, action, decision_note, submission_key)
VALUES
  ('test-notification-1', 'test-resource-1', NULL,
   '00000000-0000-0000-0000-000000000001',
   'reviewed_pending', 'Registro de teste para validar a trilha administrativa.', 
   '00000000-0000-0000-0000-000000000101');

DO $$
BEGIN
  IF (SELECT count(*) FROM public.mercado_pago_reconciliation_audit) <> 1 THEN
    RAISE EXCEPTION 'service_role could not read inserted audit row';
  END IF;

  BEGIN
    UPDATE public.mercado_pago_reconciliation_audit
      SET decision_note = 'Tentativa de alteração do histórico';
    RAISE EXCEPTION 'UPDATE unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'UPDATE unexpectedly succeeded' THEN RAISE; END IF;
    IF SQLERRM <> 'Registros de auditoria são imutáveis' THEN RAISE; END IF;
  END;

  BEGIN
    DELETE FROM public.mercado_pago_reconciliation_audit;
    RAISE EXCEPTION 'DELETE unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'DELETE unexpectedly succeeded' THEN RAISE; END IF;
    IF SQLERRM <> 'Registros de auditoria são imutáveis' THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO public.mercado_pago_reconciliation_audit
      (notification_id, resource_id, admin_user_id, action, decision_note, submission_key)
    VALUES
      ('test-notification-1', 'test-resource-1',
       '00000000-0000-0000-0000-000000000001',
       'reviewed_pending', 'Tentativa de duplicar chave de submissão.',
       '00000000-0000-0000-0000-000000000101');
    RAISE EXCEPTION 'Duplicate submission_key unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.mercado_pago_reconciliation_audit
      (notification_id, resource_id, admin_user_id, action, decision_note, submission_key)
    VALUES
      ('test-notification-1', 'test-resource-1',
       '00000000-0000-0000-0000-000000000001',
       'resolve', 'Tentativa de usar ação não permitida.',
       '00000000-0000-0000-0000-000000000102');
    RAISE EXCEPTION 'Invalid action unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END;
$$;
RESET ROLE;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.mercado_pago_reconciliation_audit) <> 1 THEN
    RAISE EXCEPTION 'Audit row count changed unexpectedly';
  END IF;
END;
$$;

\echo 'PASS: RLS, grants, service_role insert/read, immutable trigger, idempotency uniqueness, and action constraint.'
