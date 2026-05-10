import { requireUuid } from '@/lib/validation/input'

/**
 * จำกัดตามสาขา แต่ยังรวมแถว legacy ที่ branch_id เป็น NULL (ข้อมูลก่อนมี multi-branch)
 * @template T
 * @param {T} query — PostgREST builder จาก .from(...)
 * @param {string | null | undefined} branchId
 * @param {string} [column] — default `branch_id`
 * @returns {T}
 */
export function scopeBranchOrLegacyNull(query, branchId, column = 'branch_id') {
  if (!branchId) return query
  try {
    const bid = requireUuid(branchId, 'branch_id')
    return query.or(`${column}.eq.${bid},${column}.is.null`)
  } catch {
    return query
  }
}
