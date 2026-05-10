-- Demo images for menu rows (served from picsum.photos; stable per product id).
-- Only updates rows with empty image_url so it is safe to re-run.
-- Guest /menu still needs policy sql/rls_guest_menu_select.sql for anon reads.

update public.products p
set image_url =
  'https://picsum.photos/seed/rd-' || replace(p.id::text, '-', '') || '/400/400'
where coalesce(p.active, true) = true
  and (p.image_url is null or btrim(p.image_url) = '');
