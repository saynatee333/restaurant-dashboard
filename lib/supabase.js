'use client'

import { formatUnknownError } from '@/lib/formatUnknownError'
import { scopeBranchOrLegacyNull } from '@/lib/supabaseBranchScope'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { isLikelyNetworkError, withRetry } from '@/lib/network/retry'
import {
  optionalDayIso,
  requirePaymentMethod,
  requirePositiveAmount,
  requirePositiveInt,
  requireTableCode,
  requireUuid,
} from '@/lib/validation/input'

/** RPC names — เผื่อ refactor DB ได้จากที่เดียว */
const RPC = Object.freeze({
  createOrder: 'pos_create_order',
  addItem: 'pos_add_item',
  submitOrder: 'pos_submit_order',
  payOrder: 'pos_payment_callback',
  mergeTables: 'pos_merge_tables',
  splitMergedTables: 'pos_split_table',
  dailySummary: 'pos_daily_summary',
})

/** Select projections — ลด payload และโฟกัสฟิลด์ที่ใช้จริง */
const PRODUCTS_SELECT = 'id, name, price, category, image_url, active, created_at'
const ORDERS_SELECT = 'id, branch_id, table_id, status, total_amount, created_at, updated_at'
const PAYMENTS_SELECT =
  'id, order_id, method, amount, status, reference, created_at'
const RETRY_OPTIONS = { retries: 2, shouldRetry: isLikelyNetworkError }

function sb() {
  return getSupabaseBrowserClient()
}

/**
 * Lazy proxy — import { supabase } จากที่เดิมได้ โดยไม่แตะ browser ตอน SSR
 */
export const supabase = new Proxy(
  {},
  {
    get(_, prop) {
      const client = sb()
      const value = client[prop]
      return typeof value === 'function' ? value.bind(client) : value
    },
  }
)

/**
 * @template T
 * @param {string} fn
 * @param {Record<string, unknown>} params
 * @returns {Promise<{ data: T | null, error: Error | null }>}
 */
async function rpc(fn, params) {
  return runQueryWithRetry(() => sb().rpc(fn, params))
}

/**
 * @param {unknown} err
 */
function toError(err) {
  if (err instanceof Error) {
    const m = typeof err.message === 'string' ? err.message.trim() : ''
    if (m && m !== '[object Object]') return err
  }
  return new Error(formatUnknownError(err))
}

/**
 * รัน query พร้อม retry เฉพาะ network error และคืนรูปแบบมาตรฐาน `{ data, error }`
 * @template T
 * @param {() => Promise<{ data: T | null, error: unknown }>} runner
 * @returns {Promise<{ data: T | null, error: Error | null }>}
 */
async function runQueryWithRetry(runner) {
  try {
    const res = await withRetry(
      async () => {
        const out = await runner()
        if (out?.error && isLikelyNetworkError(out.error)) {
          throw toError(out.error)
        }
        return out
      },
      RETRY_OPTIONS
    )
    return {
      data: res?.data ?? null,
      error: res?.error ? toError(res.error) : null,
    }
  } catch (err) {
    return { data: null, error: toError(err) }
  }
}

/**
 * เปิดบิลใหม่ — `pos_create_order`
 * @param {string} tableCode
 */
export async function createOrder(tableCode) {
  const code = requireTableCode(tableCode)
  return rpc(RPC.createOrder, { table_code: code })
}

/**
 * เพิ่มรายการ — `pos_add_item`
 */
export async function addItemToOrder(orderId, productId, qty) {
  const safeOrderId = requireUuid(orderId, 'order_id')
  const safeProductId = requireUuid(productId, 'product_id')
  const safeQty = requirePositiveInt(qty, 'qty')
  return rpc(RPC.addItem, {
    order_id: safeOrderId,
    product_id: safeProductId,
    qty: safeQty,
  })
}

/**
 * ยืนยันบิล — `pos_submit_order`
 */
export async function submitOrder(orderId) {
  const safeOrderId = requireUuid(orderId, 'order_id')
  return rpc(RPC.submitOrder, { order_id: safeOrderId })
}

function clampInt(n, min, max, fallback) {
  const x = Number.parseInt(String(n), 10)
  if (Number.isNaN(x)) return fallback
  return Math.min(max, Math.max(min, x))
}

/**
 * เมนูที่ active — ตาราง `products`
 * @param {{ category?: string, limit?: number, branchId?: string | null }} [options]
 */
export async function fetchProducts(options = {}) {
  const { category, limit: rawLimit, branchId } = options
  const limit = clampInt(rawLimit ?? 200, 1, 500, 200)

  let q = sb()
    .from('products')
    .select(PRODUCTS_SELECT)
    .eq('active', true)

  q = scopeBranchOrLegacyNull(q, branchId, 'branch_id')

  if (category?.trim()) {
    q = q.eq('category', category.trim())
  }

  const { data, error } = await runQueryWithRetry(() =>
    q
      .order('category', { ascending: true })
      .order('name', { ascending: true })
      .limit(limit)
  )

  return { data, error }
}

/**
 * รายการออเดอร์ — ตาราง `orders`
 * @param {{ statuses?: string[], limit?: number, tableId?: string, branchId?: string | null }} [options]
 */
export async function fetchOrders(options = {}) {
  const { statuses, limit: rawLimit, tableId, branchId } = options
  const limit = clampInt(rawLimit ?? 100, 1, 500, 100)

  let q = sb().from('orders').select(ORDERS_SELECT)

  if (statuses?.length) {
    q = q.in('status', statuses)
  }

  if (tableId) {
    q = q.eq('table_id', tableId)
  }

  q = scopeBranchOrLegacyNull(q, branchId, 'branch_id')

  const { data, error } = await runQueryWithRetry(() =>
    q
      .order('created_at', { ascending: false })
      .limit(limit)
  )

  return { data, error }
}

/**
 * ชำระเงิน — `pos_payment_callback` (บันทึก `payments`, ตั้งออเดอร์เป็น paid)
 * @param {'cash' | 'card' | 'qr'} method
 */
export async function payOrder(orderId, method, amount, reference = null) {
  const safeOrderId = requireUuid(orderId, 'order_id')
  const safeMethod = requirePaymentMethod(method)
  const safeAmount = requirePositiveAmount(amount)
  return rpc(RPC.payOrder, {
    order_id: safeOrderId,
    method: safeMethod,
    amount: safeAmount,
    reference: reference == null || reference === '' ? null : String(reference).trim(),
  })
}

/**
 * ประวัติการชำระของออเดอร์ — ตาราง `payments`
 */
export async function fetchPaymentsByOrder(orderId) {
  const safeOrderId = requireUuid(orderId, 'order_id')
  return runQueryWithRetry(() =>
    sb()
      .from('payments')
      .select(PAYMENTS_SELECT)
      .eq('order_id', safeOrderId)
      .order('created_at', { ascending: false })
  )
}

/**
 * โหลดออเดอร์พร้อมรหัสโต๊ะ (สำหรับหน้า pay / redirect)
 */
export async function fetchOrderWithTableCode(orderId) {
  const safeOrderId = requireUuid(orderId, 'order_id')
  const o = await runQueryWithRetry(() =>
    sb()
      .from('orders')
      .select('id, status, total_amount, table_id')
      .eq('id', safeOrderId)
      .maybeSingle()
  )

  if (o.error) return o
  const row = o.data
  if (!row?.table_id) {
    return { data: row ? { ...row, table_code: null } : null, error: null }
  }

  const t = await runQueryWithRetry(() =>
    sb().from('tables').select('code').eq('id', row.table_id).maybeSingle()
  )

  return {
    data: {
      ...row,
      table_code: t.data?.code ?? null,
    },
    error: t.error,
  }
}

/**
 * รวมโต๊ะ — ย้ายออเดอร์ค้างจากโต๊ะรอง → โต๊ะหลัก (`pos_merge_tables`)
 */
export async function mergeTables(primaryCode, secondaryCode) {
  const safePrimary = requireTableCode(primaryCode)
  const safeSecondary = requireTableCode(secondaryCode)
  return rpc(RPC.mergeTables, {
    primary_code: safePrimary,
    secondary_code: safeSecondary,
  })
}

/**
 * แยกโต๊ะที่เคยรวม — คืนสถานะโต๊ะย่อย (`pos_split_table`)
 */
export async function splitMergedTables(primaryCode) {
  const safePrimary = requireTableCode(primaryCode)
  return rpc(RPC.splitMergedTables, {
    primary_code: safePrimary,
  })
}

/**
 * สรุปยอดรายวัน — `pos_daily_summary(day)` (UTC date boundary ตาม Postgres session)
 * @param {string} dayIso — `YYYY-MM-DD`
 */
export async function fetchDailySummary(dayIso) {
  const day = optionalDayIso(dayIso)
  return rpc(RPC.dailySummary, { day })
}
