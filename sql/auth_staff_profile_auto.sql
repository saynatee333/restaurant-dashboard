-- =============================================================================
-- สร้าง staff_profiles อัตโนมัติ (แก้ "ล็อกอินแล้วยังไม่มีสิทธิ์ / โหลดเมนู POS ไม่ได้")
-- 1) backfill ผู้ใช้ auth ที่ยังไม่มีแถวใน staff_profiles
-- 2) trigger สำหรับ user ใหม่หลังนี้
-- รันครั้งเดียวใน Supabase SQL Editor (idempotent)
-- ต้องมีตาราง public.staff_profiles แล้ว (เช่น จาก apply_public_menu_bundle.sql)
-- =============================================================================

-- --- Backfill: user เก่าที่ยังไม่มีโปรไฟล์ ---
insert into public.staff_profiles (user_id, role, updated_at)
select u.id, 'cashier', now()
from auth.users u
where not exists (
  select 1 from public.staff_profiles sp where sp.user_id = u.id
)
on conflict (user_id) do nothing;

-- --- Trigger: user ใหม่ ---
create or replace function public.handle_new_user_staff_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.staff_profiles (user_id, role, updated_at)
  values (new.id, 'cashier', now())
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_staff_profile on auth.users;

create trigger on_auth_user_created_staff_profile
  after insert on auth.users
  for each row
  execute procedure public.handle_new_user_staff_profile();

comment on function public.handle_new_user_staff_profile() is
  'Ensures every auth.users row gets a staff_profiles row (default cashier).';
