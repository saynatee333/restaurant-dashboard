import { jsonErr, jsonForbidden, jsonOk, jsonUnauthorized, withRouteHandler } from '@/lib/api/http'
import { getAuthenticatedUserOrNull, getStaffRole } from '@/lib/api/staffAuth'
import { logWarn } from '@/lib/logger'
import { isIntegrationRequest } from '@/lib/api/integrationAuth'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getServiceRoleKey } from '@/lib/env'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export const GET = withRouteHandler('GET /api/v1/branches', async (request) => {
  if (isIntegrationRequest(request)) {
    if (!getServiceRoleKey()) {
      return jsonErr('Server missing SUPABASE_SERVICE_ROLE_KEY', {
        code: 'SERVICE_UNAVAILABLE',
        status: 503,
      })
    }
    const admin = createSupabaseAdminClient()
    const { data, error } = await admin
      .from('branches')
      .select('id,code,name,active,created_at')
      .eq('active', true)
      .order('code', { ascending: true })

    if (error) {
      logWarn('GET /api/v1/branches integration', { message: error.message })
      return jsonErr('Failed to load branches', { code: 'DB_ERROR', status: 502 })
    }

    return jsonOk({ branches: data ?? [] })
  }

  const supabase = createSupabaseServerClient()
  const user = await getAuthenticatedUserOrNull(supabase)
  if (!user) return jsonUnauthorized()

  const role = await getStaffRole(supabase, user.id)
  if (role !== 'admin') return jsonForbidden('Admin only')

  const { data, error } = await supabase
    .from('branches')
    .select('id,code,name,active,created_at')
    .order('code', { ascending: true })

  if (error) {
    logWarn('GET /api/v1/branches session', { message: error.message })
    return jsonErr('Failed to load branches', { code: 'DB_ERROR', status: 502 })
  }

  return jsonOk({ branches: data ?? [] })
})
