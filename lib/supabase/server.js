import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getPublicSupabaseEnv } from '@/lib/env'

/**
 * Server Supabase client (Route Handlers, Server Components, Server Actions).
 * Persists auth session via cookies when using Supabase Auth.
 */
export function createSupabaseServerClient() {
  const { url, anonKey } = getPublicSupabaseEnv()
  const cookieStore = cookies()

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        } catch {
          // Called from a Server Component — middleware will refresh session when needed.
        }
      },
    },
  })
}
