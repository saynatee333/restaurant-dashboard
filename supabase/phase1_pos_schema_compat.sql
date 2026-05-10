-- Phase 1 POS schema (compat mode)
-- Use this file when your database already has old tables.

-- 1) Tables
create table if not exists public.tables (
  id bigserial primary key,
  code text unique,
  zone text not null default 'main',
  seat_capacity int not null default 4,
  status text not null default 'available',
  merged_into bigint references public.tables(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Existing tables schema may be different; add missing columns safely.
alter table if exists public.tables add column if not exists code text;
alter table if exists public.tables add column if not exists zone text default 'main';
alter table if exists public.tables add column if not exists seat_capacity int default 4;
alter table if exists public.tables add column if not exists status text default 'available';
alter table if exists public.tables add column if not exists merged_into bigint references public.tables(id) on delete set null;
alter table if exists public.tables add column if not exists updated_at timestamptz default now();

create table if not exists public.menu_items (
  id bigserial primary key,
  name text not null,
  category text not null default 'other',
  station text not null default 'kitchen',
  price numeric(10,2) not null default 0,
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

create table if not exists public.payments (
  id bigserial primary key,
  order_id bigint not null,
  method text not null default 'cash',
  amount numeric(10,2) not null default 0,
  status text not null default 'pending',
  reference_code text,
  paid_at timestamptz
);

-- 2) Existing core tables (orders / order_items) - add missing columns only
alter table if exists public.orders add column if not exists order_type text default 'dine_in';
alter table if exists public.orders add column if not exists customer_name text;
alter table if exists public.orders add column if not exists customer_phone text;
alter table if exists public.orders add column if not exists customer_address text;
alter table if exists public.orders add column if not exists subtotal numeric(10,2) default 0;
alter table if exists public.orders add column if not exists tax numeric(10,2) default 0;
alter table if exists public.orders add column if not exists service_charge numeric(10,2) default 0;
alter table if exists public.orders add column if not exists total_amount numeric(10,2) default 0;
alter table if exists public.orders add column if not exists notes text;
alter table if exists public.orders add column if not exists updated_at timestamptz default now();

alter table if exists public.order_items add column if not exists line_total numeric(10,2) default 0;
alter table if exists public.order_items add column if not exists note text;
alter table if exists public.order_items add column if not exists status text default 'pending';
alter table if exists public.order_items add column if not exists selected_modifiers jsonb default '[]'::jsonb;

-- 3) Constraints (safe creation in DO blocks)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_status_chk'
  ) then
    alter table public.orders add constraint orders_status_chk
      check (status in ('pending', 'in_progress', 'served', 'paid', 'cancelled'));
  end if;
exception when undefined_table then
  null;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_order_type_chk'
  ) then
    alter table public.orders add constraint orders_order_type_chk
      check (order_type in ('dine_in', 'takeaway', 'delivery'));
  end if;
exception when undefined_table then
  null;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'order_items_status_chk'
  ) then
    alter table public.order_items add constraint order_items_status_chk
      check (status in ('pending', 'firing', 'done', 'cancelled'));
  end if;
exception when undefined_table then
  null;
end $$;

-- 4) Indexes
create index if not exists idx_orders_status_created_at on public.orders(status, created_at desc);
create index if not exists idx_order_items_order_id on public.order_items(order_id);
create index if not exists idx_tables_status on public.tables(status);

-- 5) updated_at trigger helper
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

-- 6) Seed demo data
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tables'
      and column_name = 'code'
  ) then
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'tables'
        and column_name = 'table_number'
    ) then
      insert into public.tables(table_number, code, zone, seat_capacity)
      select seed.table_number, seed.code, seed.zone, seed.seat_capacity
      from (
        values
          (1, 'A1', 'front', 4),
          (2, 'A2', 'front', 4),
          (3, 'B1', 'window', 2),
          (4, 'B2', 'window', 2)
      ) as seed(table_number, code, zone, seat_capacity)
      where not exists (
        select 1
        from public.tables t
        where t.code = seed.code
           or t.table_number::text = seed.table_number::text
      );
    else
      insert into public.tables(code, zone, seat_capacity)
      select seed.code, seed.zone, seed.seat_capacity
      from (
        values
          ('A1', 'front', 4),
          ('A2', 'front', 4),
          ('B1', 'window', 2),
          ('B2', 'window', 2)
      ) as seed(code, zone, seat_capacity)
      where not exists (
        select 1
        from public.tables t
        where t.code = seed.code
      );
    end if;
  elsif exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tables'
      and column_name = 'table_number'
  ) then
    insert into public.tables(table_number, zone, seat_capacity)
    select seed.table_number, seed.zone, seed.seat_capacity
    from (
      values
        (1, 'front', 4),
        (2, 'front', 4),
        (3, 'window', 2),
        (4, 'window', 2)
    ) as seed(table_number, zone, seat_capacity)
    where not exists (
      select 1
      from public.tables t
      where t.table_number::text = seed.table_number::text
    );
  end if;
end $$;

insert into public.menu_items(name, category, station, price)
values
  ('อเมริกาโน่เย็น', 'coffee', 'bar', 75),
  ('ลาเต้เย็น', 'coffee', 'bar', 85),
  ('ข้าวผัดกุ้ง', 'main', 'kitchen', 120),
  ('ผัดไทยกุ้งสด', 'main', 'kitchen', 110),
  ('บานอฟฟี่', 'dessert', 'dessert', 95)
on conflict do nothing;
