-- Phase 1.2 operations: merge/split table, payment callback, reporting
-- Run after phase1_pos_schema_compat.sql and phase1_1_workflow.sql

create or replace function public.pos_merge_tables(
  p_primary_table_id bigint,
  p_secondary_table_id bigint
)
returns void
language plpgsql
security definer
as $$
begin
  if p_primary_table_id = p_secondary_table_id then
    raise exception 'Cannot merge the same table';
  end if;

  perform 1 from public.tables where id = p_primary_table_id;
  if not found then
    raise exception 'Primary table % not found', p_primary_table_id;
  end if;

  perform 1 from public.tables where id = p_secondary_table_id;
  if not found then
    raise exception 'Secondary table % not found', p_secondary_table_id;
  end if;

  update public.orders
  set table_id = p_primary_table_id
  where table_id = p_secondary_table_id
    and status in ('pending', 'in_progress', 'served');

  update public.tables
  set merged_into = p_primary_table_id, status = 'occupied'
  where id = p_secondary_table_id;

  update public.tables
  set merged_into = null, status = 'occupied'
  where id = p_primary_table_id;
end;
$$;

create or replace function public.pos_split_merged_tables(
  p_primary_table_id bigint
)
returns int
language plpgsql
security definer
as $$
declare
  v_count int;
begin
  update public.tables
  set merged_into = null,
      status = 'available'
  where merged_into = p_primary_table_id;

  get diagnostics v_count = row_count;

  update public.tables
  set status = case
    when exists (
      select 1
      from public.orders o
      where o.table_id = p_primary_table_id
        and o.status in ('pending', 'in_progress', 'served')
    ) then 'occupied'
    else 'available'
  end
  where id = p_primary_table_id;

  return v_count;
end;
$$;

create or replace function public.pos_payment_callback(
  p_order_id bigint,
  p_method text,
  p_amount numeric,
  p_reference_code text default null
)
returns public.orders
language plpgsql
security definer
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;

  if p_amount < 0 then
    raise exception 'Amount must be >= 0';
  end if;

  insert into public.payments(order_id, method, amount, status, reference_code, paid_at)
  values (p_order_id, coalesce(p_method, 'qr'), p_amount, 'paid', p_reference_code, now());

  if v_order.status <> 'paid' then
    select * into v_order
    from public.pos_transition_order_status(p_order_id, 'paid');
  end if;

  return v_order;
end;
$$;

create or replace function public.pos_daily_summary(
  p_day date default current_date
)
returns table (
  day date,
  total_orders int,
  paid_orders int,
  cancelled_orders int,
  gross_sales numeric,
  dine_in_sales numeric,
  takeaway_sales numeric,
  delivery_sales numeric
)
language sql
stable
as $$
  with base as (
    select *
    from public.orders
    where created_at >= p_day::timestamptz
      and created_at < (p_day::timestamptz + interval '1 day')
  )
  select
    p_day as day,
    count(*)::int as total_orders,
    count(*) filter (where status = 'paid')::int as paid_orders,
    count(*) filter (where status = 'cancelled')::int as cancelled_orders,
    coalesce(sum(total_amount) filter (where status = 'paid'), 0)::numeric as gross_sales,
    coalesce(sum(total_amount) filter (where status = 'paid' and order_type = 'dine_in'), 0)::numeric as dine_in_sales,
    coalesce(sum(total_amount) filter (where status = 'paid' and order_type = 'takeaway'), 0)::numeric as takeaway_sales,
    coalesce(sum(total_amount) filter (where status = 'paid' and order_type = 'delivery'), 0)::numeric as delivery_sales
  from base;
$$;
