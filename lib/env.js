/**
 * Public env (browser-safe). Server-only secrets belong in process.env without NEXT_PUBLIC_.
 */
export function getPublicSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env.local.'
    )
  }

  return { url, anonKey }
}

export function getServiceRoleKey() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) return null
  return key
}

/** Server-only API key for `/api/v1/*` integration routes (optional). */
export function getIntegrationApiKey() {
  const key = process.env.INTEGRATION_API_KEY
  if (!key || !key.trim()) return null
  return key.trim()
}
