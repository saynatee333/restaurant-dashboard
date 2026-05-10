import { createClient } from '@supabase/supabase-js'
import { getPublicSupabaseEnv, getServiceRoleKey } from '@/lib/env'

/**
 * Service-role client — server-only (imports bypass RLS). Never expose to the browser.
 */
export function createSupabaseAdminClient() {
  const serviceRoleKey = getServiceRoleKey()
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set.')
  }
  const { url } = getPublicSupabaseEnv()
  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
