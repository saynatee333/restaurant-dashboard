-- Phase 1 POS schema for Supabase (Postgres)
-- Run this in Supabase SQL editor.

create extension if not exists "uuid-ossp";

create table if not exists public.tables (
  id bigserial primary key,
  code text not null unique,
  zone text not null default 'main',
  seat_capacity int not null default 4,
  status text not null default 'available' check (status in ('available', 'occupied', 'reserved', 'dirty')),
  merged_into bigint references public.tables(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.menu_items (
  id bigserial primary key,
  name text not null,
  category text not null default 'other',
  station text not null default 'kitchen' check (station in ('kitchen', 'bar', 'dessert')),
  price numeric(10,2) not null check (price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.modifier_groups (
  id bigserial primary key,
  name text not null,
  is_required boolean not null default false,
  min_select int not null default 0,
  max_select int not null default 1
);

create table if not exists public.modifier_options (
  id bigserial primary key,
  group_id bigint not null references public.modifier_groups(id) on delete cascade,
  label text not null,
  price_delta numeric(10,2) not null default 0
);

create table if not exists public.menu_item_modifier_groups (
  menu_item_id bigint not null references public.menu_items(id) on delete cascade,
  group_id bigint not null references public.modifier_groups(id) on delete cascade,
  primary key (menu_item_id, group_id)
);

create table if not exists public.orders (
  id bigserial primary key,
  table_id bigint references public.tables(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'served', 'paid', 'cancelled')),
  order_type text not null default 'dine_in' check (order_type in ('dine_in', 'takeaway', 'delivery')),
  customer_name text,
  customer_phone text,
  customer_address text,
  subtotal numeric(10,2) not null default 0,
  tax numeric(10,2) not null default 0,
  service_charge numeric(10,2) not null default 0,
  total_amount numeric(10,2) not null default 0,
  notes text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id bigserial primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  menu_id bigint references public.menu_items(id) on delete set null,
  qty int not null check (qty > 0),
  price numeric(10,2) not null default 0,
  line_total numeric(10,2) not null default 0,
  note text,
  status text not null default 'pending' check (status in ('pending', 'firing', 'done', 'cancelled')),
  selected_modifiers jsonb not null default '[]'::jsonb
);

create table if not exists public.payments (
  id bigserial primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  method text not null check (method in ('cash', 'card', 'qr')),
  amount numeric(10,2) not null check (amount >= 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'void')),
  reference_code text,
  paid_at timestamptz
);

create index if not exists idx_orders_status_created_at on public.orders(status, created_at desc);
create index if not exists idx_order_items_order_id on public.order_items(order_id);
create index if not exists idx_tables_status on public.tables(status);

-- Keep updated_at fresh
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

drop trigger if exists trg_tables_updated_at on public.tables;
create trigger trg_tables_updated_at
before update on public.tables
for each row execute function public.set_updated_at();

-- Seed minimum tables/menu for demo
insert into public.tables(code, zone, seat_capacity)
values ('A1', 'front', 4), ('A2', 'front', 4), ('B1', 'window', 2), ('B2', 'window', 2)
on conflict (code) do nothing;

insert into public.menu_items(name, category, station, price)
values
  ('อเมริกาโน่เย็น', 'coffee', 'bar', 75),
  ('ลาเต้เย็น', 'coffee', 'bar', 85),
  ('ข้าวผัดกุ้ง', 'main', 'kitchen', 120),
  ('ผัดไทยกุ้งสด', 'main', 'kitchen', 110),
  ('บานอฟฟี่', 'dessert', 'dessert', 95)
on conflict do nothing;
