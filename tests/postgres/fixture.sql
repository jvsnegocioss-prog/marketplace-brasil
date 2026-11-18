-- Disposable PostgreSQL fixture. Never points to Supabase or production.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end
$$;

create schema if not exists auth;
create table auth.users (
  id uuid primary key
);

create table public.orders (
  id uuid primary key,
  status text not null,
  created_at timestamptz not null default now(),
  checkout_idempotency_key text,
  checkout_request_hash text
);

create unique index orders_checkout_idempotency_key_uidx
  on public.orders (checkout_idempotency_key)
  where checkout_idempotency_key is not null;

-- Minimal deterministic stand-in for the existing production order RPC.
-- The wrapper migration is tested against this disposable database only.
create or replace function public.create_store_order_with_coupon_and_delivery(
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_delivery_address text,
  p_items jsonb,
  p_coupon_code text,
  p_delivery_neighborhood_id uuid,
  p_checkout_idempotency_key text,
  p_checkout_request_hash text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $fixture$
declare
  v_order_id uuid;
  v_existing_hash text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_checkout_idempotency_key, 0));
  select id, checkout_request_hash
    into v_order_id, v_existing_hash
  from public.orders
  where checkout_idempotency_key = p_checkout_idempotency_key;

  if found then
    if v_existing_hash is distinct from p_checkout_request_hash then
      raise exception 'Idempotency request hash mismatch';
    end if;
    return v_order_id;
  end if;

  insert into public.orders (id, status, checkout_idempotency_key, checkout_request_hash)
  values (gen_random_uuid(), 'aguardando', p_checkout_idempotency_key, p_checkout_request_hash)
  returning id into v_order_id;

  return v_order_id;
end;
$fixture$;

create or replace function public.cancel_unpaid_order_and_restore_stock(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_rows integer;
begin
  update public.orders set status = 'Cancelado'
   where id = p_order_id and lower(trim(status)) = 'aguardando';
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;
