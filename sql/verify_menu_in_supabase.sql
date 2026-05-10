-- คัดลอกไปรันทีละบล็อกใน Supabase → SQL Editor เพื่อตรวจว่าเมนูควรขึ้นหรือไม่
-- (ไม่แก้ข้อมูล — แค่ตรวจสอบ)

-- 1) มีสินค้า active หรือไม่
select
  count(*) as total_rows,
  count(*) filter (where active) as active_rows,
  count(*) filter (where active and (image_url is null or btrim(image_url) = '')) as active_missing_image
from public.products;

-- 2) นโยบาย RLS บนตาราง products
-- ควรเห็นอย่างน้อย: p_products_select_anon_public_menu (anon) + p_products_select_staff_branch (authenticated)
select
  pol.polname as policy_name,
  pol.polcmd as cmd,
  pg_get_expr(pol.polqual, pol.polrelid, true) as using_expression
from pg_policy pol
where pol.polrelid = 'public.products'::regclass
order by pol.polname;

-- 3) RLS เปิดอยู่หรือไม่
select
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'products';

-- 4) การกระจาย branch_id — ถ้าเป็น (null) ทั้งหมด แต่เมนูไม่ขึ้นขณะล็อกอิน พนักงาน = ต้องมี policy ที่อนุญาต branch_id is null
select coalesce(branch_id::text, '(null)') as branch_id, count(*) as cnt
from public.products
group by 1
order by 2 desc;
