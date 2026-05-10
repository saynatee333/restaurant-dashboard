-- POS RPC functions — UUID schema (public.tables, products, orders, order_items, payments)
-- Prerequisites: sql/production_pos_schema.sql (enums + tables)
-- Safe merge/split requires merged_into on tables (added below if missing).

alter table public.tables
  add column if not exists merged_into uuid references public.tables (id) on delete set null;

create index if not exists idx_tables_merged_into on public.tables (merged_into);

-- -----------------------------------------------------------------------------
-- Internal: recalculate order total from line items (unit price × qty)
-- -----------------------------------------------------------------------------
create or replace function public._pos_order_items_total(p_order_id uuid)
returns numeric(14, 2)
language sql
stable
as $$
  select coalesce(round(sum(oi.price * oi.qty)::numeric, 2), 0)::numeric(14, 2)
  from public.order_items oi
  where oi.order_id = p_order_id;
$$;

-- -----------------------------------------------------------------------------
-- 1) pos_create_order — open a new bill for a table (by code)
-- -----------------------------------------------------------------------------
create or replace function public.pos_create_order(table_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := trim(table_code);
  v_table public.tables%rowtype;
  v_order_id uuid;
begin
  if v_code = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_table_code', 'message', 'table_code is empty');
  end if;

  select * into v_table
  from public.tables t
  where t.code = v_code
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error', 'table_not_found',
      'message', format('No table with code %s', v_code),
      'table_code', v_code
    );
  end if;

  if exists (
    select 1
    from public.orders o
    where o.table_id = v_table.id
      and o.status in ('pending', 'confirmed')
  ) then
    return jsonb_build_object(
      'ok', false,
      'error', 'table_has_open_order',
      'message', 'Close or pay the existing order before opening a new one',
      'table_id', v_table.id,
      'table_code', v_table.code
    );
  end if;

  insert into public.orders (table_id, status, total_amount)
  values (v_table.id, 'pending', 0)
  returning id into v_order_id;

  update public.tables
  set status = 'occupied'::public.table_status
  where id = v_table.id;

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order_id,
    'table_id', v_table.id,
    'table_code', v_table.code,
    'status', 'pending',
    'total_amount', 0
  );
exception
  when others then
    return jsonb_build_object(
      'ok', false,
      'error', 'internal_error',
      'message', sqlerrm,
      'detail', sqlstate
    );
end;
$$;

-- -----------------------------------------------------------------------------
-- 2) pos_add_item — add line; snapshots product unit price; refreshes total
-- -----------------------------------------------------------------------------
create or replace function public.pos_add_item(order_id uuid, product_id uuid, qty int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_product public.products%rowtype;
  v_line_id uuid;
  v_total numeric(14, 2);
begin
  if qty is null or qty <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_qty', 'message', 'qty must be > 0');
  end if;

  select * into v_order
  from public.orders o
  where o.id = order_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'order_not_found', 'order_id', order_id);
  end if;

  if v_order.status <> 'pending'::public.order_status then
    return jsonb_build_object(
      'ok', false,
      'error', 'order_not_editable',
      'message', 'Items can only be added while order is pending',
      'status', v_order.status::text
    );
  end if;

  select * into v_product
  from public.products p
  where p.id = product_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'product_not_found', 'product_id', product_id);
  end if;

  if not v_product.active then
    return jsonb_build_object(
      'ok', false,
      'error', 'product_inactive',
      'product_id', product_id,
      'name', v_product.name
    );
  end if;

  insert into public.order_items (order_id, product_id, qty, price)
  values (order_id, product_id, qty, v_product.price)
  returning id into v_line_id;

  v_total := public._pos_order_items_total(order_id);

  update public.orders
  set total_amount = v_total
  where id = order_id;

  return jsonb_build_object(
    'ok', true,
    'order_item_id', v_line_id,
    'order_id', order_id,
    'product_id', product_id,
    'product_name', v_product.name,
    'qty', qty,
    'unit_price', v_product.price,
    'total_amount', v_total
  );
exception
  when others then
    return jsonb_build_object(
      'ok', false,
      'error', 'internal_error',
      'message', sqlerrm,
      'detail', sqlstate
    );
end;
$$;

-- -----------------------------------------------------------------------------
-- 3) pos_submit_order — confirm bill (pending → confirmed), sync total from lines
-- -----------------------------------------------------------------------------
create or replace function public.pos_submit_order(order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_total numeric(14, 2);
  v_lines int;
begin
  select * into v_order
  from public.orders o
  where o.id = order_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'order_not_found', 'order_id', order_id);
  end if;

  if v_order.status <> 'pending'::public.order_status then
    return jsonb_build_object(
      'ok', false,
      'error', 'invalid_status',
      'message', 'Only pending orders can be submitted',
      'status', v_order.status::text
    );
  end if;

  select count(*)::int into v_lines from public.order_items oi where oi.order_id = order_id;

  if v_lines = 0 then
    return jsonb_build_object(
      'ok', false,
      'error', 'empty_order',
      'message', 'Add at least one line item before submit'
    );
  end if;

  v_total := public._pos_order_items_total(order_id);

  update public.orders
  set status = 'confirmed', total_amount = v_total
  where id = order_id;

  return jsonb_build_object(
    'ok', true,
    'order_id', order_id,
    'status', 'confirmed',
    'total_amount', v_total,
    'line_count', v_lines
  );
exception
  when others then
    return jsonb_build_object(
      'ok', false,
      'error', 'internal_error',
      'message', sqlerrm,
      'detail', sqlstate
    );
end;
$$;

-- -----------------------------------------------------------------------------
-- 4) pos_merge_tables — move open orders from secondary → primary; link merge metadata
-- -----------------------------------------------------------------------------
create or replace function public.pos_merge_tables(primary_code text, secondary_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pri text := trim(primary_code);
  v_sec text := trim(secondary_code);
  v_primary public.tables%rowtype;
  v_secondary public.tables%rowtype;
  v_moved int;
begin
  if v_pri = '' or v_sec = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_code', 'message', 'Codes must be non-empty');
  end if;

  if v_pri = v_sec then
    return jsonb_build_object('ok', false, 'error', 'same_table', 'message', 'Primary and secondary must differ');
  end if;

  select * into v_primary from public.tables t where t.code = v_pri for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'primary_not_found', 'table_code', v_pri);
  end if;

  select * into v_secondary from public.tables t where t.code = v_sec for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'secondary_not_found', 'table_code', v_sec);
  end if;

  update public.orders o
  set table_id = v_primary.id
  where o.table_id = v_secondary.id
    and o.status in ('pending', 'confirmed');

  get diagnostics v_moved = row_count;

  update public.tables
  set merged_into = v_primary.id, status = 'occupied'::public.table_status
  where id = v_secondary.id;

  update public.tables
  set merged_into = null, status = 'occupied'::public.table_status
  where id = v_primary.id;

  return jsonb_build_object(
    'ok', true,
    'primary_table_id', v_primary.id,
    'primary_code', v_primary.code,
    'secondary_table_id', v_secondary.id,
    'secondary_code', v_secondary.code,
    'orders_moved', v_moved
  );
exception
  when others then
    return jsonb_build_object(
      'ok', false,
      'error', 'internal_error',
      'message', sqlerrm,
      'detail', sqlstate
    );
end;
$$;

-- -----------------------------------------------------------------------------
-- 5) pos_split_table — undo merge metadata for children of primary table code
-- -----------------------------------------------------------------------------
create or replace function public.pos_split_table(primary_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := trim(primary_code);
  v_primary public.tables%rowtype;
  v_unmerged int;
begin
  if v_code = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_code', 'message', 'primary_code is empty');
  end if;

  select * into v_primary from public.tables t where t.code = v_code for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'primary_not_found', 'table_code', v_code);
  end if;

  update public.tables t
  set merged_into = null,
      status = case
        when exists (
          select 1 from public.orders o
          where o.table_id = t.id and o.status in ('pending', 'confirmed')
        ) then 'occupied'::public.table_status
        else 'available'::public.table_status
      end
  where t.merged_into = v_primary.id;

  get diagnostics v_unmerged = row_count;

  update public.tables t
  set status = case
    when exists (
      select 1 from public.orders o
      where o.table_id = t.id and o.status in ('pending', 'confirmed')
    ) then 'occupied'::public.table_status
    else 'available'::public.table_status
  end
  where t.id = v_primary.id;

  return jsonb_build_object(
    'ok', true,
    'primary_table_id', v_primary.id,
    'primary_code', v_primary.code,
    'tables_unmerged', v_unmerged
  );
exception
  when others then
    return jsonb_build_object(
      'ok', false,
      'error', 'internal_error',
      'message', sqlerrm,
      'detail', sqlstate
    );
end;
$$;

-- -----------------------------------------------------------------------------
-- 6) pos_payment_callback — record payment; mark order paid when amount matches total
-- -----------------------------------------------------------------------------
create or replace function public.pos_payment_callback(
  order_id uuid,
  method text,
  amount numeric,
  reference text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_method public.payment_method;
  v_pay_id uuid;
  v_ref text := nullif(trim(coalesce(reference, '')), '');
begin
  if amount is null or amount < 0 then
    perform public.log_payment_callback_event(
      'payment_callback_failed',
      order_id,
      'invalid_amount',
      method,
      amount,
      v_ref
    );
    return jsonb_build_object('ok', false, 'error', 'invalid_amount', 'message', 'amount must be >= 0');
  end if;

  begin
    v_method := lower(trim(method))::public.payment_method;
  exception
    when invalid_text_representation then
      perform public.log_payment_callback_event(
        'payment_callback_failed',
        order_id,
        'invalid_payment_method',
        method,
        amount,
        v_ref
      );
      return jsonb_build_object(
        'ok', false,
        'error', 'invalid_payment_method',
        'message', format('method must be cash|card|qr, got %s', method)
      );
  end;

  select * into v_order
  from public.orders o
  where o.id = order_id
  for update;

  if not found then
    perform public.log_payment_callback_event(
      'payment_callback_failed',
      order_id,
      'order_not_found',
      v_method::text,
      amount,
      v_ref
    );
    return jsonb_build_object('ok', false, 'error', 'order_not_found', 'order_id', order_id);
  end if;

  if v_order.status = 'cancelled'::public.order_status then
    perform public.log_payment_callback_event(
      'payment_callback_failed',
      v_order.id,
      'order_cancelled',
      v_method::text,
      amount,
      v_ref
    );
    return jsonb_build_object('ok', false, 'error', 'order_cancelled', 'order_id', order_id);
  end if;

  if v_order.status = 'paid'::public.order_status then
    perform public.log_payment_callback_event(
      'payment_callback_failed',
      v_order.id,
      'already_paid',
      v_method::text,
      amount,
      v_ref
    );
    return jsonb_build_object(
      'ok', false,
      'error', 'already_paid',
      'order_id', order_id,
      'total_amount', v_order.total_amount
    );
  end if;

  if v_order.status <> 'confirmed'::public.order_status then
    perform public.log_payment_callback_event(
      'payment_callback_failed',
      v_order.id,
      'order_not_payable',
      v_method::text,
      amount,
      v_ref,
      jsonb_build_object('status', v_order.status)
    );
    return jsonb_build_object(
      'ok', false,
      'error', 'order_not_payable',
      'message', 'Order must be confirmed before payment',
      'status', v_order.status::text
    );
  end if;

  if round(amount::numeric, 2) <> round(v_order.total_amount::numeric, 2) then
    perform public.log_payment_callback_event(
      'payment_callback_failed',
      v_order.id,
      'amount_mismatch',
      v_method::text,
      amount,
      v_ref,
      jsonb_build_object(
        'expected', v_order.total_amount,
        'received', amount
      )
    );
    return jsonb_build_object(
      'ok', false,
      'error', 'amount_mismatch',
      'message', 'Payment amount must equal order total',
      'expected', v_order.total_amount,
      'received', amount
    );
  end if;

  insert into public.payments (order_id, method, amount, status, reference)
  values (order_id, v_method, amount, 'paid'::public.payment_status, v_ref)
  returning id into v_pay_id;

  update public.orders
  set status = 'paid'::public.order_status
  where id = order_id;

  if v_order.table_id is not null then
    update public.tables t
    set status = case
      when exists (
        select 1 from public.orders o
        where o.table_id = t.id and o.status in ('pending', 'confirmed')
      ) then 'occupied'::public.table_status
      else 'available'::public.table_status
    end
    where t.id = v_order.table_id;
  end if;

  perform public.log_payment_callback_event(
    'payment_callback_success',
    v_order.id,
    'paid',
    v_method::text,
    amount,
    v_ref,
    jsonb_build_object(
      'payment_id', v_pay_id,
      'order_status', 'paid'
    )
  );

  return jsonb_build_object(
    'ok', true,
    'payment_id', v_pay_id,
    'order_id', order_id,
    'status', 'paid',
    'amount', amount,
    'method', v_method::text
  );
exception
  when others then
    perform public.log_payment_callback_event(
      'payment_callback_failed',
      order_id,
      'internal_error',
      method,
      amount,
      v_ref,
      jsonb_build_object(
        'sqlstate', sqlstate,
        'message', sqlerrm
      )
    );
    return jsonb_build_object(
      'ok', false,
      'error', 'internal_error',
      'message', sqlerrm,
      'detail', sqlstate
    );
end;
$$;

-- -----------------------------------------------------------------------------
-- 7) pos_daily_summary — aggregates for a calendar day (UTC date boundary)
-- Dine-in = paid order with table_id set; takeaway = paid order without table.
-- -----------------------------------------------------------------------------
create or replace function public.pos_daily_summary(day date)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_start timestamptz := day::timestamptz;
  v_end timestamptz := (day + 1)::timestamptz;
  r record;
  v_top jsonb;
begin
  if day is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_day', 'message', 'day is required');
  end if;

  select
    count(*)::bigint as total_orders,
    count(*) filter (where status = 'paid'::public.order_status)::bigint as paid_orders,
    count(*) filter (where status = 'cancelled'::public.order_status)::bigint as cancelled_orders,
    coalesce(round(sum(total_amount) filter (where status = 'paid'::public.order_status), 2), 0)::numeric as gross_sales,
    count(*) filter (
      where status = 'paid'::public.order_status and table_id is not null
    )::bigint as dine_in_orders,
    count(*) filter (
      where status = 'paid'::public.order_status and table_id is null
    )::bigint as takeaway_orders,
    coalesce(
      round(
        sum(total_amount) filter (
          where status = 'paid'::public.order_status and table_id is not null
        ),
        2
      ),
      0
    )::numeric as dine_in_sales,
    coalesce(
      round(
        sum(total_amount) filter (
          where status = 'paid'::public.order_status and table_id is null
        ),
        2
      ),
      0
    )::numeric as takeaway_sales
  into r
  from public.orders o
  where o.created_at >= v_start and o.created_at < v_end;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'product_id', t.product_id,
        'name', t.name,
        'qty_sold', t.qty_sold,
        'revenue', t.revenue
      )
      order by t.qty_sold desc
    ),
    '[]'::jsonb
  )
  into v_top
  from (
    select
      p.id as product_id,
      p.name as name,
      sum(oi.qty)::bigint as qty_sold,
      round(sum(oi.qty * oi.price)::numeric, 2) as revenue
    from public.order_items oi
    inner join public.orders o on o.id = oi.order_id
    inner join public.products p on p.id = oi.product_id
    where o.created_at >= v_start
      and o.created_at < v_end
      and o.status = 'paid'::public.order_status
    group by p.id, p.name
    order by qty_sold desc
    limit 10
  ) t;

  return jsonb_build_object(
    'ok', true,
    'day', day,
    'timezone_note', 'Bounds use PostgreSQL session timezone for date→timestamptz; Supabase typically UTC.',
    'total_orders', r.total_orders,
    'paid_orders', r.paid_orders,
    'cancelled_orders', r.cancelled_orders,
    'gross_sales', r.gross_sales,
    'dine_in_orders', r.dine_in_orders,
    'takeaway_orders', r.takeaway_orders,
    'dine_in_sales', r.dine_in_sales,
    'takeaway_sales', r.takeaway_sales,
    'top_products', coalesce(v_top, '[]'::jsonb)
  );
exception
  when others then
    return jsonb_build_object(
      'ok', false,
      'error', 'internal_error',
      'message', sqlerrm,
      'detail', sqlstate
    );
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants (adjust roles to match your RLS policy)
-- -----------------------------------------------------------------------------
revoke execute on function public._pos_order_items_total(uuid) from public;

revoke execute on function public.pos_create_order(text) from public;
revoke execute on function public.pos_add_item(uuid, uuid, int) from public;
revoke execute on function public.pos_submit_order(uuid) from public;
revoke execute on function public.pos_merge_tables(text, text) from public;
revoke execute on function public.pos_split_table(text) from public;
revoke execute on function public.pos_payment_callback(uuid, text, numeric, text) from public;
revoke execute on function public.pos_daily_summary(date) from public;

grant execute on function public.pos_create_order(text) to authenticated, service_role;
grant execute on function public.pos_add_item(uuid, uuid, int) to authenticated, service_role;
grant execute on function public.pos_submit_order(uuid) to authenticated, service_role;
grant execute on function public.pos_merge_tables(text, text) to authenticated, service_role;
grant execute on function public.pos_split_table(text) to authenticated, service_role;
grant execute on function public.pos_payment_callback(uuid, text, numeric, text) to authenticated, service_role;
grant execute on function public.pos_daily_summary(date) to authenticated, service_role;
