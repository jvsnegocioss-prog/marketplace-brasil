-- Bind customer orders to the authenticated Supabase user, never by email alone.
-- Existing guest orders are intentionally NOT backfilled: email equality is not proof of ownership.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS customer_user_id uuid
  REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS orders_customer_user_id_created_at_idx
  ON public.orders (customer_user_id, created_at DESC)
  WHERE customer_user_id IS NOT NULL;

COMMENT ON COLUMN public.orders.customer_user_id IS
  'Authenticated Supabase user who owns this order. NULL for guest orders; never infer ownership from customer_email.';
