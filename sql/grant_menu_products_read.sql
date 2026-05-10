-- ถ้าเมนูว่างแต่ไม่มี error ใน UI / หรือ API คืน 502 จาก PostgREST
-- ลองรันใน Supabase SQL Editor (ปลอดภัยซ้ำได้)

grant usage on schema public to anon, authenticated;
grant select on table public.products to anon, authenticated;
