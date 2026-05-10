-- Multi-branch + staff roles (optional migration — apply in Supabase SQL editor)
-- Existing rows keep branch_id NULL until backfilled (app treats NULL as "no branch filter").

create extension if not exists pgcrypto;

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.staff_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  branch_id uuid references public.branches (id),
  role text not null default 'cashier'
    check (role in ('admin', 'cashier', 'kitchen')),
  updated_at timestamptz not null default now()
);

create index if not exists idx_staff_profiles_branch on public.staff_profiles (branch_id);

-- Nullable FKs: existing installs stay valid without backfill
alter table public.orders add column if not exists branch_id uuid references public.branches (id);
alter table public.tables add column if not exists branch_id uuid references public.branches (id);
alter table public.products add column if not exists branch_id uuid references public.branches (id);

create index if not exists idx_orders_branch_id on public.orders (branch_id);
create index if not exists idx_tables_branch_id on public.tables (branch_id);
create index if not exists idx_products_branch_id on public.products (branch_id);

comment on table public.branches is 'Restaurant branches / stores';
comment on table public.staff_profiles is 'Maps auth.users to branch + role for POS/KDS access';

-- Example RLS (tune per deployment — admins often need service role or bypass policies)
-- alter table public.branches enable row level security;
-- create policy branches_select_staff on public.branches for select to authenticated using (active = true);
-- alter table public.staff_profiles enable row level security;
-- create policy staff_self_read on public.staff_profiles for select to authenticated using (auth.uid() = user_id);
