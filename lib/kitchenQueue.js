import { requireUuid } from '@/lib/validation/input'
import { supabase } from '@/lib/supabase'

/** สถานะที่แสดงบนจอครัว (ไม่ดึง done มาในคิวหลัก) */
export const KITCHEN_QUEUE_STATUSES = ['pending', 'firing']

const LIMIT = 200

const SELECT_WITH_MENU_ITEMS =
  'id, qty, note, status, selected_modifiers, orders(id, table_id, branch_id, created_at), menu_items(name, station)'

const SELECT_WITH_MENUS =
  'id, qty, note, status, selected_modifiers, orders(id, table_id, branch_id, created_at), menus(name, station)'

/**
 * @param {string | null | undefined} branchId
 */
function applyBranchFilter(query, branchId) {
  if (!branchId) return query
  try {
    const bid = requireUuid(branchId, 'branch_id')
    return query.or(`branch_id.eq.${bid},branch_id.is.null`, {
      foreignTable: 'orders',
    })
  } catch {
    return query
  }
}

/**
 * Loads kitchen queue rows; retries with legacy `menus` join if `menu_items` fails.
 * @param {string | null | undefined} [branchId]
 * @returns {Promise<{ data: unknown[] | null, error: unknown }>}
 */
export async function fetchKitchenQueueRows(branchId = null) {
  let result = await applyBranchFilter(
    supabase
      .from('order_items')
      .select(SELECT_WITH_MENU_ITEMS)
      .in('status', KITCHEN_QUEUE_STATUSES),
    branchId
  )
    .order('id', { ascending: false })
    .limit(LIMIT)

  if (result.error) {
    result = await applyBranchFilter(
      supabase
        .from('order_items')
        .select(SELECT_WITH_MENUS)
        .in('status', KITCHEN_QUEUE_STATUSES),
      branchId
    )
      .order('id', { ascending: false })
      .limit(LIMIT)
  }

  return result
}

/** @param {Record<string, unknown>} row */
export function menuRefFromKitchenRow(row) {
  return row.menu_items || row.menus
}

/**
 * แบ่งรายการคิวครัวตาม order_items.status (รอบเดียวผ่านอาร์เรย์)
 * @param {Array<Record<string, unknown>>} rows
 * @returns {{ pending: typeof rows, firing: typeof rows }}
 */
export function groupKitchenQueueByStatus(rows) {
  const pending = []
  const firing = []
  for (const row of rows) {
    if (row.status === 'pending') pending.push(row)
    else if (row.status === 'firing') firing.push(row)
  }
  return { pending, firing }
}
