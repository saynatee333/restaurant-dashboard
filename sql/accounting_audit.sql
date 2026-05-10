-- Accounting + audit foundation for POS
-- Requested schema:
--   audit_logs(id, user_id, action, entity, entity_id, payload, created_at)
-- Plus helper functions and triggers for order/payment events.

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Canonical audit table (backward-compatible if table already exists)
-- -----------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity text not null,
  entity_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.audit_logs
  add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.audit_logs
  add column if not exists action text;
alter table public.audit_logs
  add column if not exists entity text;
alter table public.audit_logs
  add column if not exists entity_id text;
alter table public.audit_logs
  add column if not exists payload jsonb not null default '{}'::jsonb;
alter table public.audit_logs
  add column if not exists created_at timestamptz not null default now();

-- Optional compatibility with older audit schema (if present)
do $$
declare
  has_actor_user_id boolean;
  has_table_name boolean;
  has_row_id boolean;
  has_before_data boolean;
  has_after_data boolean;
  has_metadata boolean;
  v_sql text;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'audit_logs' and column_name = 'actor_user_id'
  ) into has_actor_user_id;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'audit_logs' and column_name = 'table_name'
  ) into has_table_name;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'audit_logs' and column_name = 'row_id'
  ) into has_row_id;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'audit_logs' and column_name = 'before_data'
  ) into has_before_data;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'audit_logs' and column_name = 'after_data'
  ) into has_after_data;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'audit_logs' and column_name = 'metadata'
  ) into has_metadata;

  if has_actor_user_id or has_table_name or has_row_id or has_before_data or has_after_data or has_metadata then
    v_sql := '
      update public.audit_logs
      set user_id = coalesce(user_id, ' ||
      case when has_actor_user_id then 'actor_user_id' else 'user_id' end || '),
          entity = coalesce(entity, ' ||
      case when has_table_name then 'table_name' else 'entity' end || '),
          entity_id = coalesce(entity_id, ' ||
      case when has_row_id then 'row_id' else 'entity_id' end || '),
          payload = coalesce(
            nullif(payload, ''{}''::jsonb),
            jsonb_build_object(
              ''before'', ' || case when has_before_data then 'before_data' else 'null' end || ',
              ''after'', ' || case when has_after_data then 'after_data' else 'null' end || ',
              ''metadata'', ' || case when has_metadata then 'metadata' else 'null' end || '
            )
          )
      where
        (payload is null or payload = ''{}''::jsonb)
        or user_id is null
        or entity is null
        or entity_id is null
    ';
    execute v_sql;
  end if;
end
$$;

alter table public.audit_logs alter column action set not null;
alter table public.audit_logs alter column entity set not null;
alter table public.audit_logs alter column entity_id set not null;

create index if not exists idx_audit_logs_created_at on public.audit_logs(created_at desc);
create index if not exists idx_audit_logs_user_id on public.audit_logs(user_id);
create index if not exists idx_audit_logs_action on public.audit_logs(action);
create index if not exists idx_audit_logs_entity on public.audit_logs(entity);
create index if not exists idx_audit_logs_entity_id on public.audit_logs(entity_id);

-- -----------------------------------------------------------------------------
-- Service function for explicit logging from RPC callbacks
-- -----------------------------------------------------------------------------
create or replace function public.log_audit_event(
  p_action text,
  p_entity text,
  p_entity_id text,
  p_payload jsonb default '{}'::jsonb,
  p_user_id uuid default auth.uid()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.audit_logs(user_id, action, entity, entity_id, payload)
  values (
    p_user_id,
    coalesce(nullif(trim(p_action), ''), 'unknown'),
    coalesce(nullif(trim(p_entity), ''), 'unknown'),
    coalesce(nullif(trim(p_entity_id), ''), 'unknown'),
    coalesce(p_payload, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.log_payment_callback_event(
  p_action text,
  p_order_id uuid,
  p_reason text,
  p_method text,
  p_amount numeric,
  p_reference text,
  p_extra jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.log_audit_event(
    p_action,
    'orders',
    coalesce(p_order_id::text, 'unknown'),
    jsonb_build_object(
      'reason', p_reason,
      'method', p_method,
      'amount', p_amount,
      'reference', p_reference
    ) || coalesce(p_extra, '{}'::jsonb)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Trigger functions: automatic logging for orders + payments
-- -----------------------------------------------------------------------------
create or replace function public.trg_audit_orders_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_audit_event(
      'order_created',
      'orders',
      new.id::text,
      jsonb_build_object(
        'branch_id', new.branch_id,
        'status', new.status,
        'table_id', new.table_id,
        'total_amount', new.total_amount
      )
    );
    return new;
  end if;

  perform public.log_audit_event(
    'order_updated',
    'orders',
    new.id::text,
    jsonb_build_object(
      'branch_id', new.branch_id,
      'old_status', old.status,
      'new_status', new.status,
      'old_total_amount', old.total_amount,
      'new_total_amount', new.total_amount
    )
  );
  return new;
end;
$$;

create or replace function public.trg_audit_payments_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text;
  v_status text;
  v_entity_id text;
  v_payload jsonb;
begin
  v_status := case when tg_op = 'DELETE' then old.status::text else new.status::text end;
  v_entity_id := case when tg_op = 'DELETE' then old.id::text else new.id::text end;

  if v_status = 'paid' then
    v_action := 'payment_success';
  elsif v_status in ('failed') then
    v_action := 'payment_fail';
  elsif v_status in ('void', 'refunded') then
    v_action := 'refund';
  else
    v_action := 'payment_updated';
  end if;

  if tg_op = 'INSERT' then
    v_payload := jsonb_build_object(
      'order_id', new.order_id,
      'status', new.status,
      'amount', new.amount,
      'method', new.method,
      'reference', new.reference
    );
  elsif tg_op = 'UPDATE' then
    v_payload := jsonb_build_object(
      'order_id', new.order_id,
      'old_status', old.status,
      'new_status', new.status,
      'old_amount', old.amount,
      'new_amount', new.amount,
      'method', new.method,
      'reference', new.reference
    );
  else
    v_payload := jsonb_build_object(
      'order_id', old.order_id,
      'status', old.status,
      'amount', old.amount,
      'method', old.method,
      'reference', old.reference
    );
  end if;

  perform public.log_audit_event(v_action, 'payments', v_entity_id, v_payload);
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_accounting_audit_orders_insert on public.orders;
create trigger trg_accounting_audit_orders_insert
after insert on public.orders
for each row execute function public.trg_audit_orders_changes();

drop trigger if exists trg_accounting_audit_orders_update on public.orders;
create trigger trg_accounting_audit_orders_update
after update of status, total_amount, table_id, branch_id on public.orders
for each row execute function public.trg_audit_orders_changes();

drop trigger if exists trg_accounting_audit_payments_insert on public.payments;
create trigger trg_accounting_audit_payments_insert
after insert on public.payments
for each row execute function public.trg_audit_payments_changes();

drop trigger if exists trg_accounting_audit_payments_update on public.payments;
create trigger trg_accounting_audit_payments_update
after update on public.payments
for each row execute function public.trg_audit_payments_changes();

drop trigger if exists trg_accounting_audit_payments_delete on public.payments;
create trigger trg_accounting_audit_payments_delete
after delete on public.payments
for each row execute function public.trg_audit_payments_changes();

