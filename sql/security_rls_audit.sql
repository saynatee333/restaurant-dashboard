-- Security hardening for multi-branch POS (Supabase/Postgres)
-- Applies:
-- 1) staff role helpers
-- 2) strict branch-scoped RLS
-- 3) audit logs for payments + order status changes

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Role model hardening: add manager support
-- -----------------------------------------------------------------------------
alter table if exists public.staff_profiles
  drop constraint if exists staff_profiles_role_check;

alter table if exists public.staff_profiles
  add constraint staff_profiles_role_check
  check (role in ('admin', 'manager', 'cashier', 'kitchen'));

-- -----------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER so policies can safely resolve profile data)
-- -----------------------------------------------------------------------------
create or replace function public.current_staff_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select sp.role
  from public.staff_profiles sp
  where sp.user_id = auth.uid()
  limit 1
$$;

create or replace function public.current_staff_branch_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select sp.branch_id
  from public.staff_profiles sp
  where sp.user_id = auth.uid()
  limit 1
$$;

create or replace function public.has_any_role(allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff_profiles sp
    where sp.user_id = auth.uid()
      and sp.role = any(allowed_roles)
  )
$$;

create or replace function public.is_valid_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_any_role(array['admin', 'manager', 'cashier', 'kitchen']::text[])
$$;

create or replace function public.can_access_branch(target_branch uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.has_any_role(array['admin']::text[])
    or (
      target_branch is not null
      and target_branch = public.current_staff_branch_id()
      and public.has_any_role(array['manager', 'cashier', 'kitchen']::text[])
    )
$$;

-- -----------------------------------------------------------------------------
-- Audit log table
-- -----------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_role text,
  actor_branch_id uuid references public.branches(id) on delete set null,
  action text not null,
  table_name text not null,
  row_id text not null,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_created_at on public.audit_logs(created_at desc);
create index if not exists idx_audit_logs_table_name on public.audit_logs(table_name);
create index if not exists idx_audit_logs_actor_user on public.audit_logs(actor_user_id);
create index if not exists idx_audit_logs_actor_branch on public.audit_logs(actor_branch_id);

create or replace function public.audit_sensitive_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text;
  v_row_id text;
  v_before jsonb;
  v_after jsonb;
  v_meta jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    v_action := lower(tg_table_name) || '.insert';
    v_row_id := new.id::text;
    v_after := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_action := lower(tg_table_name) || '.update';
    v_row_id := new.id::text;
    v_before := to_jsonb(old);
    v_after := to_jsonb(new);
  else
    v_action := lower(tg_table_name) || '.delete';
    v_row_id := old.id::text;
    v_before := to_jsonb(old);
  end if;

  -- Enrich audit metadata for known sensitive changes
  if tg_table_name = 'orders' and tg_op = 'UPDATE' then
    v_meta := jsonb_build_object(
      'status_changed', (old.status is distinct from new.status),
      'from_status', old.status,
      'to_status', new.status,
      'order_branch_id', new.branch_id
    );
  elsif tg_table_name = 'payments' then
    v_meta := case
      when tg_op = 'INSERT' then jsonb_build_object(
        'payment_status', new.status,
        'order_id', new.order_id
      )
      when tg_op = 'UPDATE' then jsonb_build_object(
        'from_status', old.status,
        'to_status', new.status,
        'order_id', new.order_id
      )
      else jsonb_build_object(
        'payment_status', old.status,
        'order_id', old.order_id
      )
    end;
  end if;

  insert into public.audit_logs(
    actor_user_id,
    actor_role,
    actor_branch_id,
    action,
    table_name,
    row_id,
    before_data,
    after_data,
    metadata
  ) values (
    auth.uid(),
    public.current_staff_role(),
    public.current_staff_branch_id(),
    v_action,
    tg_table_name,
    v_row_id,
    v_before,
    v_after,
    v_meta
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- Only log order updates when status actually changes
drop trigger if exists trg_audit_orders_status on public.orders;
create trigger trg_audit_orders_status
after update of status on public.orders
for each row
when (old.status is distinct from new.status)
execute function public.audit_sensitive_changes();

drop trigger if exists trg_audit_payments_insert on public.payments;
create trigger trg_audit_payments_insert
after insert on public.payments
for each row
execute function public.audit_sensitive_changes();

drop trigger if exists trg_audit_payments_update on public.payments;
create trigger trg_audit_payments_update
after update on public.payments
for each row
execute function public.audit_sensitive_changes();

drop trigger if exists trg_audit_payments_delete on public.payments;
create trigger trg_audit_payments_delete
after delete on public.payments
for each row
execute function public.audit_sensitive_changes();

-- -----------------------------------------------------------------------------
-- Enable and force RLS on all core tables
-- -----------------------------------------------------------------------------
alter table public.branches enable row level security;
alter table public.staff_profiles enable row level security;
alter table public.tables enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.audit_logs enable row level security;

alter table public.branches force row level security;
alter table public.staff_profiles force row level security;
alter table public.tables force row level security;
alter table public.products force row level security;
alter table public.orders force row level security;
alter table public.order_items force row level security;
alter table public.payments force row level security;
alter table public.audit_logs force row level security;

-- -----------------------------------------------------------------------------
-- Clear old policies (idempotent re-run)
-- -----------------------------------------------------------------------------
drop policy if exists p_branches_select_staff on public.branches;

drop policy if exists p_staff_profiles_select_self on public.staff_profiles;
drop policy if exists p_staff_profiles_select_admin_manager on public.staff_profiles;

drop policy if exists p_tables_select_staff_branch on public.tables;
drop policy if exists p_tables_insert_admin_manager on public.tables;
drop policy if exists p_tables_update_admin_manager on public.tables;
drop policy if exists p_tables_delete_admin_only on public.tables;

drop policy if exists p_products_select_staff_branch on public.products;
drop policy if exists p_products_insert_admin_manager on public.products;
drop policy if exists p_products_update_admin_manager on public.products;
drop policy if exists p_products_delete_admin_only on public.products;

drop policy if exists p_orders_select_staff_branch on public.orders;
drop policy if exists p_orders_insert_cashier_manager_admin on public.orders;
drop policy if exists p_orders_update_role_guard_branch on public.orders;
drop policy if exists p_orders_delete_admin_only on public.orders;

drop policy if exists p_order_items_select_staff_branch on public.order_items;
drop policy if exists p_order_items_insert_cashier_manager_admin on public.order_items;
drop policy if exists p_order_items_update_kitchen_cashier_manager_admin on public.order_items;
drop policy if exists p_order_items_delete_admin_manager_only on public.order_items;

drop policy if exists p_payments_select_staff_branch on public.payments;
drop policy if exists p_payments_insert_cashier_manager_admin on public.payments;
drop policy if exists p_payments_update_admin_manager_only on public.payments;
drop policy if exists p_payments_delete_admin_only on public.payments;

drop policy if exists p_audit_logs_select_admin_or_manager_branch on public.audit_logs;

-- -----------------------------------------------------------------------------
-- Policies: branches + staff_profiles
-- -----------------------------------------------------------------------------
create policy p_branches_select_staff
on public.branches
for select
to authenticated
using (
  public.is_valid_staff()
  and (
    public.has_any_role(array['admin']::text[])
    or id = public.current_staff_branch_id()
  )
);

-- Staff can read own profile; admin/manager can read profiles in own branch; admin can read all
create policy p_staff_profiles_select_self
on public.staff_profiles
for select
to authenticated
using (user_id = auth.uid());

create policy p_staff_profiles_select_admin_manager
on public.staff_profiles
for select
to authenticated
using (
  public.has_any_role(array['admin']::text[])
  or (
    public.has_any_role(array['manager']::text[])
    and branch_id = public.current_staff_branch_id()
  )
);

-- -----------------------------------------------------------------------------
-- Policies: tables
-- -----------------------------------------------------------------------------
create policy p_tables_select_staff_branch
on public.tables
for select
to authenticated
using (
  public.is_valid_staff()
  and public.can_access_branch(branch_id)
);

create policy p_tables_insert_admin_manager
on public.tables
for insert
to authenticated
with check (
  public.has_any_role(array['admin', 'manager']::text[])
  and public.can_access_branch(branch_id)
);

create policy p_tables_update_admin_manager
on public.tables
for update
to authenticated
using (
  public.has_any_role(array['admin', 'manager']::text[])
  and public.can_access_branch(branch_id)
)
with check (
  public.has_any_role(array['admin', 'manager']::text[])
  and public.can_access_branch(branch_id)
);

create policy p_tables_delete_admin_only
on public.tables
for delete
to authenticated
using (public.has_any_role(array['admin']::text[]));

-- -----------------------------------------------------------------------------
-- Policies: products
-- -----------------------------------------------------------------------------
create policy p_products_select_staff_branch
on public.products
for select
to authenticated
using (
  public.is_valid_staff()
  and (
    branch_id is null
    or public.can_access_branch(branch_id)
  )
);

create policy p_products_insert_admin_manager
on public.products
for insert
to authenticated
with check (
  public.has_any_role(array['admin', 'manager']::text[])
  and public.can_access_branch(branch_id)
);

create policy p_products_update_admin_manager
on public.products
for update
to authenticated
using (
  public.has_any_role(array['admin', 'manager']::text[])
  and public.can_access_branch(branch_id)
)
with check (
  public.has_any_role(array['admin', 'manager']::text[])
  and public.can_access_branch(branch_id)
);

create policy p_products_delete_admin_only
on public.products
for delete
to authenticated
using (public.has_any_role(array['admin']::text[]));

-- -----------------------------------------------------------------------------
-- Policies: orders
-- -----------------------------------------------------------------------------
create policy p_orders_select_staff_branch
on public.orders
for select
to authenticated
using (
  public.is_valid_staff()
  and public.can_access_branch(branch_id)
);

create policy p_orders_insert_cashier_manager_admin
on public.orders
for insert
to authenticated
with check (
  public.has_any_role(array['admin', 'manager', 'cashier']::text[])
  and public.can_access_branch(branch_id)
);

create policy p_orders_update_role_guard_branch
on public.orders
for update
to authenticated
using (
  public.has_any_role(array['admin', 'manager', 'cashier', 'kitchen']::text[])
  and public.can_access_branch(branch_id)
)
with check (
  public.has_any_role(array['admin', 'manager', 'cashier', 'kitchen']::text[])
  and public.can_access_branch(branch_id)
);

create policy p_orders_delete_admin_only
on public.orders
for delete
to authenticated
using (
  public.has_any_role(array['admin']::text[])
  and public.can_access_branch(branch_id)
);

-- -----------------------------------------------------------------------------
-- Policies: order_items (branch-scoped via parent order)
-- -----------------------------------------------------------------------------
create policy p_order_items_select_staff_branch
on public.order_items
for select
to authenticated
using (
  public.is_valid_staff()
  and exists (
    select 1
    from public.orders o
    where o.id = order_items.order_id
      and public.can_access_branch(o.branch_id)
  )
);

create policy p_order_items_insert_cashier_manager_admin
on public.order_items
for insert
to authenticated
with check (
  public.has_any_role(array['admin', 'manager', 'cashier']::text[])
  and exists (
    select 1
    from public.orders o
    where o.id = order_items.order_id
      and public.can_access_branch(o.branch_id)
  )
);

create policy p_order_items_update_kitchen_cashier_manager_admin
on public.order_items
for update
to authenticated
using (
  public.has_any_role(array['admin', 'manager', 'cashier', 'kitchen']::text[])
  and exists (
    select 1
    from public.orders o
    where o.id = order_items.order_id
      and public.can_access_branch(o.branch_id)
  )
)
with check (
  public.has_any_role(array['admin', 'manager', 'cashier', 'kitchen']::text[])
  and exists (
    select 1
    from public.orders o
    where o.id = order_items.order_id
      and public.can_access_branch(o.branch_id)
  )
);

create policy p_order_items_delete_admin_manager_only
on public.order_items
for delete
to authenticated
using (
  public.has_any_role(array['admin', 'manager']::text[])
  and exists (
    select 1
    from public.orders o
    where o.id = order_items.order_id
      and public.can_access_branch(o.branch_id)
  )
);

-- -----------------------------------------------------------------------------
-- Policies: payments (branch-scoped via parent order)
-- -----------------------------------------------------------------------------
create policy p_payments_select_staff_branch
on public.payments
for select
to authenticated
using (
  public.is_valid_staff()
  and exists (
    select 1
    from public.orders o
    where o.id = payments.order_id
      and public.can_access_branch(o.branch_id)
  )
);

create policy p_payments_insert_cashier_manager_admin
on public.payments
for insert
to authenticated
with check (
  public.has_any_role(array['admin', 'manager', 'cashier']::text[])
  and exists (
    select 1
    from public.orders o
    where o.id = payments.order_id
      and public.can_access_branch(o.branch_id)
  )
);

create policy p_payments_update_admin_manager_only
on public.payments
for update
to authenticated
using (
  public.has_any_role(array['admin', 'manager']::text[])
  and exists (
    select 1
    from public.orders o
    where o.id = payments.order_id
      and public.can_access_branch(o.branch_id)
  )
)
with check (
  public.has_any_role(array['admin', 'manager']::text[])
  and exists (
    select 1
    from public.orders o
    where o.id = payments.order_id
      and public.can_access_branch(o.branch_id)
  )
);

create policy p_payments_delete_admin_only
on public.payments
for delete
to authenticated
using (
  public.has_any_role(array['admin']::text[])
  and exists (
    select 1
    from public.orders o
    where o.id = payments.order_id
      and public.can_access_branch(o.branch_id)
  )
);

-- -----------------------------------------------------------------------------
-- Policies: audit logs (admin all branches; manager own branch)
-- -----------------------------------------------------------------------------
create policy p_audit_logs_select_admin_or_manager_branch
on public.audit_logs
for select
to authenticated
using (
  public.has_any_role(array['admin']::text[])
  or (
    public.has_any_role(array['manager']::text[])
    and actor_branch_id = public.current_staff_branch_id()
  )
);

-- No insert/update/delete policies on audit_logs for authenticated.
-- Only trigger function writes; staff can only read by policy above.
