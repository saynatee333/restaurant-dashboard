-- Production-grade restaurant POS schema for Supabase (PostgreSQL)
-- Run in Supabase SQL Editor once per environment (or via migration pipeline).
-- If `public.tables` / `public.orders` already exist with different shapes, resolve conflicts before applying.

-- -----------------------------------------------------------------------------
-- Extensions
-- -----------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'order_status') then
    create type public.order_status as enum (
      'pending',
      'confirmed',
      'paid',
      'cancelled'
    );
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'table_status') then
    create type public.table_status as enum (
      'available',
      'occupied',
      'reserved',
      'dirty'
    );
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'payment_method') then
    create type public.payment_method as enum (
      'cash',
      'card',
      'qr'
    );
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'payment_status') then
    create type public.payment_status as enum (
      'pending',
      'paid',
      'failed',
      'void'
    );
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
create table if not exists public.tables (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  table_number int not null,
  zone text not null default 'main',
  seat_capacity int not null default 4 check (seat_capacity > 0),
  status public.table_status not null default 'available',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tables_code_unique unique (code),
  constraint tables_table_number_zone_unique unique (table_number, zone)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric(12, 2) not null check (price >= 0),
  category text not null default 'general',
  image_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_name_not_empty check (length(trim(name)) > 0)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  table_id uuid references public.tables (id) on delete set null,
  status public.order_status not null default 'pending',
  total_amount numeric(14, 2) not null default 0 check (total_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid not null references public.products (id) on restrict,
  qty int not null check (qty > 0),
  price numeric(12, 2) not null check (price >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  method public.payment_method not null,
  amount numeric(14, 2) not null check (amount >= 0),
  status public.payment_status not null default 'pending',
  reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_reference_not_blank_if_present check (
    reference is null or length(trim(reference)) > 0
  )
);

-- -----------------------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------------------
create index if not exists idx_tables_status on public.tables (status);
create index if not exists idx_tables_zone on public.tables (zone);

create index if not exists idx_products_active_category on public.products (active, category);
create index if not exists idx_products_category_name on public.products (category, name);

create index if not exists idx_orders_table_id on public.orders (table_id);
create index if not exists idx_orders_status_created_at on public.orders (status, created_at desc);
create index if not exists idx_orders_created_at on public.orders (created_at desc);

create index if not exists idx_order_items_order_id on public.order_items (order_id);
create index if not exists idx_order_items_product_id on public.order_items (product_id);

create index if not exists idx_payments_order_id on public.payments (order_id);
create index if not exists idx_payments_status_created_at on public.payments (status, created_at desc);

-- -----------------------------------------------------------------------------
-- Audit: updated_at
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_tables_updated_at on public.tables;
create trigger trg_tables_updated_at
before update on public.tables
for each row execute function public.set_updated_at();

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at
before update on public.products
for each row execute function public.set_updated_at();

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

drop trigger if exists trg_order_items_updated_at on public.order_items;
create trigger trg_order_items_updated_at
before update on public.order_items
for each row execute function public.set_updated_at();

drop trigger if exists trg_payments_updated_at on public.payments;
create trigger trg_payments_updated_at
before update on public.payments
for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Seed: tables + products (idempotent)
-- -----------------------------------------------------------------------------
insert into public.tables (code, table_number, zone, seat_capacity, status)
values
  ('A1', 1, 'main', 4, 'available'),
  ('A2', 2, 'main', 4, 'available'),
  ('B1', 1, 'window', 2, 'available'),
  ('B2', 2, 'window', 2, 'available')
on conflict (code) do nothing;

insert into public.products (name, price, category, image_url, active)
select v.name, v.price, v.category, v.image_url, v.active
from (
  values
    ('Americano Iced'::text, 75.00::numeric, 'coffee'::text, null::text, true),
    ('Latte Iced', 85.00, 'coffee', null, true),
    ('Pad Thai', 110.00, 'main', null, true),
    ('Fried Rice Shrimp', 120.00, 'main', null, true),
    ('Banoffee', 95.00, 'dessert', null, true)
) as v(name, price, category, image_url, active)
where not exists (
  select 1 from public.products p where p.name = v.name
);
