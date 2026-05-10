import { jsonErr, jsonOk, jsonUnauthorized, withRouteHandler } from '@/lib/api/http'
import {
  parseOptionalBranchId,
  parseOrderLimit,
  parseOrderPage,
  parseOrderStatuses,
  toRange,
} from '@/lib/api/ordersParams'
import { getAuthenticatedUserOrNull } from '@/lib/api/staffAuth'
import { logWarn } from '@/lib/logger'
import { integrationBranchId, isIntegrationRequest } from '@/lib/api/integrationAuth'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getServiceRoleKey } from '@/lib/env'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export const GET = withRouteHandler('GET /api/v1/orders', async (request) => {
  const { searchParams } = new URL(request.url)
  const limit = parseOrderLimit(searchParams)
  const page = parseOrderPage(searchParams)
  const { from, to } = toRange({ page, limit })
  const rawBranchFromQuery = searchParams.get('branch_id')?.trim() || null
  const statuses = parseOrderStatuses(searchParams)
  const parsedBranch = parseOptionalBranchId(rawBranchFromQuery)
  if (parsedBranch.error) {
    return jsonErr(parsedBranch.error, { code: 'BAD_REQUEST', status: 400 })
  }
  const branchFromQuery = parsedBranch.value

  const select =
    'id,branch_id,table_id,status,total_amount,created_at,updated_at'

  if (isIntegrationRequest(request)) {
    if (!getServiceRoleKey()) {
      return jsonErr('Server missing SUPABASE_SERVICE_ROLE_KEY', {
        code: 'SERVICE_UNAVAILABLE',
        status: 503,
      })
    }
    const admin = createSupabaseAdminClient()
    const rawBranch = branchFromQuery || integrationBranchId(request)
    const parsedIntegrationBranch = parseOptionalBranchId(rawBranch)
    if (parsedIntegrationBranch.error) {
      return jsonErr(parsedIntegrationBranch.error, { code: 'BAD_REQUEST', status: 400 })
    }
    const branch = parsedIntegrationBranch.value

    let q = admin
      .from('orders')
      .select(select)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)

    if (branch) q = q.eq('branch_id', branch)
    if (statuses?.length) q = q.in('status', statuses)

    const { data, error } = await q
    if (error) {
      logWarn('GET /api/v1/orders integration', { message: error.message })
      return jsonErr('Failed to load orders', { code: 'DB_ERROR', status: 502 })
    }
    const rows = data ?? []
    const hasMore = rows.length === limit
    return jsonOk({
      orders: rows,
      meta: {
        page,
        limit,
        has_more: hasMore,
        next_page: hasMore ? page + 1 : null,
        branch_id: branch,
      },
    })
  }

  const supabase = createSupabaseServerClient()
  const user = await getAuthenticatedUserOrNull(supabase)
  if (!user) return jsonUnauthorized()

  let q = supabase
    .from('orders')
    .select(select)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to)

  if (branchFromQuery) q = q.eq('branch_id', branchFromQuery)
  if (statuses?.length) q = q.in('status', statuses)

  const { data, error } = await q
  if (error) {
    logWarn('GET /api/v1/orders session', { message: error.message })
    return jsonErr('Failed to load orders', { code: 'DB_ERROR', status: 502 })
  }

  const rows = data ?? []
  const hasMore = rows.length === limit
  return jsonOk({
    orders: rows,
    meta: {
      page,
      limit,
      has_more: hasMore,
      next_page: hasMore ? page + 1 : null,
    },
  })
})
