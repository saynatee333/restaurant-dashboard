-- ต้องมีฟังก์ชัน public.is_valid_staff() อยู่แล้ว (จาก sql/security_rls_audit.sql)
-- ถ้าเจอ ERROR 42883 ให้รัน sql/apply_public_menu_bundle.sql แทน — ไฟล์นั้นสร้าง helpers ให้ครบ
--
-- Fix: พนักงานที่ล็อกอินแล้วเปิด /menu ใช้ JWT บทบาท authenticated — ไม่ใช้ policy ฝั่ง anon
-- ถ้า products.branch_id เป็น NULL (เมนูกลาง) can_access_branch(NULL) เดิมคืน false → เมนูว่าง
-- รันไฟล์นี้หลัง security_rls_audit.sql (หรือรันซ้ำได้ — drop/create policy เดิม)

drop policy if exists p_products_select_staff_branch on public.products;

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
