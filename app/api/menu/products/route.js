import { createClient } from '@supabase/supabase-js'
import { getPublicSupabaseEnv } from '@/lib/env'
import { jsonErr, jsonOk, withRouteHandler } from '@/lib/api/http'
import { logWarn } from '@/lib/logger'

export const dynamic = 'force-dynamic'

/** คอลัมน์เดียวกับ POS / หน้าเมนู (ไม่ส่ง branch_id — แสดงทุก active ที่ anon มองได้) */
const MENU_PRODUCTS_SELECT = 'id,name,price,category,image_url,active,created_at'

/**
 * โหลดเมนูแขกด้วย anon key ฝั่งเซิร์ฟเวอร์เท่านั้น
 * (ไม่ใช้คุกกี้เซสชันพนักงาน — แก้กรณีล็อกอินแล้ว JWT เป็น authenticated แต่ RLS ไม่ให้อ่าน products)
 */
export const GET = withRouteHandler('GET /api/menu/products', async () => {
  let url
  let anonKey
  try {
    ;({ url, anonKey } = getPublicSupabaseEnv())
  } catch {
    return jsonErr('เซิร์ฟเวอร์ยังไม่ตั้งค่า Supabase', {
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
    })
  }

  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await client
    .from('products')
    .select(MENU_PRODUCTS_SELECT)
    .eq('active', true)
    .order('category', { ascending: true })
    .order('name', { ascending: true })
    .limit(400)

  if (error) {
    logWarn('GET /api/menu/products', {
      message: error.message,
      code: error.code,
      details: error.details,
    })
    return jsonErr('โหลดเมนูจากฐานข้อมูลไม่สำเร็จ', {
      code: 'UPSTREAM',
      status: 502,
      details: error.message,
    })
  }

  return jsonOk({ products: data ?? [] })
})
