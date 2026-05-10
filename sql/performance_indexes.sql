-- Performance indexes for high-traffic POS queries
-- Safe to run multiple times.

-- Requested composite index for orders list APIs and dashboard drill-downs
create index if not exists idx_orders_status_branch_created_at
  on public.orders(status, branch_id, created_at desc);

-- Requested lookup indexes
create index if not exists idx_payments_order_id
  on public.payments(order_id);

create index if not exists idx_order_items_order_id
  on public.order_items(order_id);
