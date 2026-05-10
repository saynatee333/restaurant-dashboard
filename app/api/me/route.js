import { jsonOk, jsonUnauthorized, withRouteHandler } from '@/lib/api/http'
import { getAuthenticatedUserOrNull, getStaffProfileRow } from '@/lib/api/staffAuth'
import { logWarn } from '@/lib/logger'
import { normalizeRole } from '@/lib/roles'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export const GET = withRouteHandler('GET /api/me', async () => {
  const supabase = createSupabaseServerClient()
  const user = await getAuthenticatedUserOrNull(supabase)
  if (!user) {
    return jsonUnauthorized()
  }

  const pr = await getStaffProfileRow(supabase, user.id)

  if (pr.error) {
    logWarn('GET /api/me staff_profiles', {
      message: pr.error.message,
      code: pr.error.code,
    })
  }

  const row = pr.data
  const role = normalizeRole(row?.role ?? 'cashier')
  const branch_id = row?.branch_id ?? null
  const br = row?.branches
  const branch =
    br && typeof br === 'object'
      ? { code: br.code ?? null, name: br.name ?? null }
      : null

  let branches = []
  if (role === 'admin') {
    const b = await supabase
      .from('branches')
      .select('id,code,name,active')
      .eq('active', true)
      .order('code', { ascending: true })
    if (b.error) {
      logWarn('GET /api/me branches', { message: b.error.message })
    } else {
      branches = b.data ?? []
    }
  }

  return jsonOk({
    profile: {
      role,
      branch_id,
      branch,
      email: user.email ?? null,
    },
    branches,
  })
})
