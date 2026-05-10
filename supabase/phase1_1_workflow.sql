-- Phase 1.1 workflow rules and RPC helpers
-- Run this after phase1_pos_schema.sql

create or replace function public.pos_transition_order_status(
  p_order_id bigint,
  p_next_status text
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

  if p_next_status not in ('pending', 'in_progress', 'served', 'paid', 'cancelled') then
    raise exception 'Invalid next status: %', p_next_status;
  end if;

  if v_order.status = p_next_status then
    return v_order;
  end if;

  if v_order.status = 'pending' and p_next_status not in ('in_progress', 'cancelled') then
    raise exception 'Invalid transition from pending to %', p_next_status;
  end if;
  if v_order.status = 'in_progress' and p_next_status not in ('served', 'cancelled') then
    raise exception 'Invalid transition from in_progress to %', p_next_status;
  end if;
  if v_order.status = 'served' and p_next_status not in ('paid', 'cancelled') then
    raise exception 'Invalid transition from served to %', p_next_status;
  end if;
  if v_order.status in ('paid', 'cancelled') then
    raise exception 'Cannot transition terminal status %', v_order.status;
  end if;

  update public.orders
  set
    status = p_next_status,
    paid_at = case when p_next_status = 'paid' then now() else paid_at end
  where id = p_order_id
  returning * into v_order;

  if p_next_status = 'paid' and v_order.table_id is not null then
    update public.tables set status = 'available' where id = v_order.table_id;
  elsif p_next_status in ('pending', 'in_progress', 'served') and v_order.table_id is not null then
    update public.tables set status = 'occupied' where id = v_order.table_id;
  end if;

  return v_order;
end;
$$;

create or replace function public.pos_move_order_table(
  p_order_id bigint,
  p_to_table_id bigint
)
returns public.orders
language plpgsql
security definer
as $$
declare
  v_order public.orders%rowtype;
  v_existing bigint;
  v_old_table_id bigint;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;

  if v_order.status in ('paid', 'cancelled') then
    raise exception 'Cannot move paid/cancelled order';
  end if;

  perform 1 from public.tables where id = p_to_table_id;
  if not found then
    raise exception 'Destination table % not found', p_to_table_id;
  end if;

  select id into v_existing
  from public.orders
  where table_id = p_to_table_id
    and status in ('pending', 'in_progress', 'served')
    and id <> p_order_id
  limit 1;

  if v_existing is not null then
    raise exception 'Destination table already has active order %', v_existing;
  end if;

  v_old_table_id := v_order.table_id;

  update public.orders
  set table_id = p_to_table_id
  where id = p_order_id
  returning * into v_order;

  update public.tables set status = 'occupied' where id = p_to_table_id;
  if v_old_table_id is not null then
    update public.tables set status = 'available' where id = v_old_table_id;
  end if;

  return v_order;
end;
$$;

create or replace function public.pos_mark_item_done(
  p_order_item_id bigint
)
returns public.order_items
language plpgsql
security definer
as $$
declare
  v_item public.order_items%rowtype;
  v_open_count int;
begin
  update public.order_items
  set status = 'done'
  where id = p_order_item_id
  returning * into v_item;

  if not found then
    raise exception 'Order item % not found', p_order_item_id;
  end if;

  select count(*) into v_open_count
  from public.order_items
  where order_id = v_item.order_id
    and status in ('pending', 'firing');

  if v_open_count = 0 then
    perform public.pos_transition_order_status(v_item.order_id, 'served');
  else
    update public.orders
    set status = case when status = 'pending' then 'in_progress' else status end
    where id = v_item.order_id;
  end if;

  return v_item;
end;
$$;
