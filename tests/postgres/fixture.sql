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
  created_at timestamptz not null default now()
);

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
