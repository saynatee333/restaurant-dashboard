import { jsonOk, withRouteHandler } from '@/lib/api/http'
import { logInfo } from '@/lib/logger'
import { getIntegrationApiKey, getPublicSupabaseEnv, getServiceRoleKey } from '@/lib/env'

export const dynamic = 'force-dynamic'

export const GET = withRouteHandler('GET /api/v1/health', async () => {
  let supabaseOk = false
  try {
    getPublicSupabaseEnv()
    supabaseOk = true
  } catch {
    supabaseOk = false
  }

  const payload = {
    ok: true,
    timestamp: new Date().toISOString(),
    supabaseConfigured: supabaseOk,
    integrationApiKeyConfigured: Boolean(getIntegrationApiKey()),
    serviceRoleConfigured: Boolean(getServiceRoleKey()),
  }

  logInfo('GET /api/v1/health', { supabaseOk })
  return jsonOk(payload)
})
