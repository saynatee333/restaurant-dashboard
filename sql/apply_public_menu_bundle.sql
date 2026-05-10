-- =============================================================================
-- เมนูแขก + พนักงาน + รูปตัวอย่าง (รันใน Supabase SQL Editor ได้ทั้งไฟล์)
-- แก้: 42883 is_valid_staff ไม่มี — สร้างตาราง + ฟังก์ชันช่วย
-- แก้: 42703 column branch_id does not exist — เพิ่มคอลัมน์บน products/orders/tables
-- =============================================================================

create extension if not exists pgcrypto;

-- ตารางที่ฟังก์ชัน RLS อ้างอิง (ไม่ทับของเดิม)
create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- คอลัมน์สาขา (แก้ ERROR 42703 column "branch_id" does not exist)
-- เทียบเท่า sql/multi_branch_roles.sql — รันก่อน policy ที่อ้าง branch_id
alter table if exists public.orders add column if not exists branch_id uuid references public.branches (id);
alter table if exists public.tables add column if not exists branch_id uuid references public.branches (id);
alter table if exists public.products add column if not exists branch_id uuid references public.branches (id);

create table if not exists public.staff_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  branch_id uuid references public.branches (id),
  role text not null default 'cashier',
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- ฟังก์ชันช่วย (เหมือน security_rls_audit.sql — ใช้ CREATE OR REPLACE)
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

-- ให้บทบาท API เรียกฟังก์ชันในเงื่อนไข policy ได้ (บางโปรเจ็กต์ยังไม่มี)
grant execute on function public.current_staff_role() to anon, authenticated;
grant execute on function public.current_staff_branch_id() to anon, authenticated;
grant execute on function public.has_any_role(text[]) to anon, authenticated;
grant execute on function public.is_valid_staff() to anon, authenticated;
grant execute on function public.can_access_branch(uuid) to anon, authenticated;

-- === แขก anon อ่าน products ===
drop policy if exists p_products_select_anon_public_menu on public.products;

create policy p_products_select_anon_public_menu
on public.products
for select
to anon
using (coalesce(active, true) = true);

-- === พนักงาน authenticated เห็นเมนูกลาง (branch_id null) ===
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

-- === รูปตัวอย่าง (เฉพาะแถวที่ image_url ว่าง) ===
update public.products p
set image_url =
  'https://picsum.photos/seed/rd-' || replace(p.id::text, '-', '') || '/400/400'
where coalesce(p.active, true) = true
  and (p.image_url is null or btrim(p.image_url) = '');

-- -----------------------------------------------------------------------------
-- ขั้นต่อไป (แยกรันได้):
--   sql/auth_staff_profile_auto.sql  — staff_profiles อัตโนมัติ
--   sql/grant_menu_products_read.sql — ถ้าเมนูว่าง / API โหลดไม่ได้ (สิทธิ์ SELECT)
-- -----------------------------------------------------------------------------
