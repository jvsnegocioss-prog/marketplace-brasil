-- DRAFT ONLY — do not apply to production.
-- Intended for review and disposable-database testing before a formal migration.
-- API writes must validate Supabase Auth + is_marketplace_admin() server-side first.

CREATE TABLE public.mercado_pago_reconciliation_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id text NOT NULL
    REFERENCES public.mercado_pago_webhook_events(notification_id)
    ON DELETE RESTRICT,
  resource_id text NOT NULL,
  order_id uuid,
  admin_user_id uuid NOT NULL,
  action text NOT NULL
    CHECK (action IN (
      'reviewed_pending',
      'evidence_requested',
      'escalated',
      'manual_followup',
      'other'
    )),
  decision_note text NOT NULL
    CHECK (char_length(btrim(decision_note)) BETWEEN 20 AND 2000),
  evidence_reference text
    CHECK (
      evidence_reference IS NULL
      OR (
        char_length(evidence_reference) <= 500
        AND evidence_reference !~* '^https?://'
      )
    ),
  submission_key uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

COMMENT ON TABLE public.mercado_pago_reconciliation_audit IS
  'Append-only administrative review history. Entries never resolve or mutate payment/order state.';
COMMENT ON COLUMN public.mercado_pago_reconciliation_audit.evidence_reference IS
  'Optional private object path/reference only; never store a public URL or secret.';
COMMENT ON COLUMN public.mercado_pago_reconciliation_audit.admin_user_id IS
  'Supabase Auth user UUID taken from the validated server-side session; intentionally no cascading FK.';

CREATE INDEX mercado_pago_reconciliation_audit_event_created_idx
  ON public.mercado_pago_reconciliation_audit (notification_id, created_at DESC);
CREATE INDEX mercado_pago_reconciliation_audit_admin_created_idx
  ON public.mercado_pago_reconciliation_audit (admin_user_id, created_at DESC);

ALTER TABLE public.mercado_pago_reconciliation_audit ENABLE ROW LEVEL SECURITY;

-- No direct browser access. The server uses service_role only after independently
-- validating the user session and is_marketplace_admin().
REVOKE ALL ON TABLE public.mercado_pago_reconciliation_audit
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.mercado_pago_reconciliation_audit
  TO service_role;

-- Defense in depth: prevent accidental mutation/deletion of historical entries.
CREATE OR REPLACE FUNCTION public.prevent_reconciliation_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'Registros de auditoria são imutáveis';
END;
$function$;

REVOKE ALL ON FUNCTION public.prevent_reconciliation_audit_mutation()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prevent_reconciliation_audit_mutation()
  TO service_role;

CREATE TRIGGER mercado_pago_reconciliation_audit_immutable
BEFORE UPDATE OR DELETE ON public.mercado_pago_reconciliation_audit
FOR EACH ROW
EXECUTE FUNCTION public.prevent_reconciliation_audit_mutation();

-- No endpoint for resolve/settle/reprocess is introduced by this draft.
