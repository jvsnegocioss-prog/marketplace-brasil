-- Record the phone-normalization fix for customer order tracking.
-- This migration is already applied to the production Supabase project.
create or replace function public.track_customer_order(
  p_order_number text,
  p_phone text
)
returns table (
  order_id uuid,
  order_number text,
  payment_status text,
  delivery_status text,
  tracking_code text,
  created_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  delivery_method text,
  estimated_delivery_at timestamptz
)
language sql
security definer
set search_path = ''
as $function$
  select
    o.id,
    o.order_number,
    o.status,
    o.delivery_status,
    o.tracking_code,
    o.created_at,
    o.shipped_at,
    o.delivered_at,
    o.delivery_method,
    o.estimated_delivery_at
  from public.orders o
  where (
    upper(o.order_number) = upper(trim(p_order_number))
    or o.id::text = trim(p_order_number)
    or upper(coalesce(o.tracking_code, '')) = upper(trim(p_order_number))
  )
  and pg_catalog.regexp_replace(coalesce(o.customer_phone, ''), '[^0-9]', '', 'g')
    = pg_catalog.regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')
  limit 1;
$function$;

revoke all on function public.track_customer_order(text, text)
  from public, anon, authenticated;
grant execute on function public.track_customer_order(text, text)
  to service_role;
