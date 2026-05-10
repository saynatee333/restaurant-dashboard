import { requireUuid } from '@/lib/validation/input'

export const DEFAULT_ORDER_LIMIT = 50
export const MAX_ORDER_LIMIT = 200
export const DEFAULT_ORDER_PAGE = 1

const ALLOWED_ORDER_STATUSES = new Set([
  'pending',
  'confirmed',
  'in_progress',
  'served',
  'paid',
  'cancelled',
])

/**
 * @param {URLSearchParams} searchParams
 */
export function parseOrderLimit(searchParams) {
  const raw = searchParams.get('limit')
  const n = raw ? Number.parseInt(raw, 10) : DEFAULT_ORDER_LIMIT
  if (Number.isNaN(n)) return DEFAULT_ORDER_LIMIT
  return Math.min(MAX_ORDER_LIMIT, Math.max(1, n))
}

/**
 * @param {URLSearchParams} searchParams
 */
export function parseOrderPage(searchParams) {
  const raw = searchParams.get('page')
  const n = raw ? Number.parseInt(raw, 10) : DEFAULT_ORDER_PAGE
  if (Number.isNaN(n)) return DEFAULT_ORDER_PAGE
  return Math.max(1, n)
}

/**
 * @param {{ page: number, limit: number }} pagination
 */
export function toRange(pagination) {
  const from = (pagination.page - 1) * pagination.limit
  const to = from + pagination.limit - 1
  return { from, to }
}

/**
 * @param {URLSearchParams} searchParams
 */
export function parseOrderStatuses(searchParams) {
  const statusesParam = searchParams.get('statuses')
  const parsed = statusesParam
    ? statusesParam.split(',').map((s) => s.trim()).filter(Boolean)
    : null
  return parsed?.length ? parsed.filter((s) => ALLOWED_ORDER_STATUSES.has(s)) : null
}

/**
 * @param {string | null | undefined} branchId
 */
export function parseOptionalBranchId(branchId) {
  if (!branchId) return { value: null, error: null }
  try {
    return { value: requireUuid(branchId, 'branch_id'), error: null }
  } catch (e) {
    return { value: null, error: e.message || 'Invalid branch_id' }
  }
}
