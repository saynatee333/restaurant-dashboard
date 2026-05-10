-- Guest QR menu: allow anon role to read active products (browser uses anon key without login).
-- Staff still use p_products_select_staff_branch (authenticated + is_valid_staff).
-- Run after sql/security_rls_audit.sql

drop policy if exists p_products_select_anon_public_menu on public.products;

create policy p_products_select_anon_public_menu
on public.products
for select
to anon
using (coalesce(active, true) = true);
