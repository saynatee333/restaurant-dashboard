'use client'

import { createBrowserClient } from '@supabase/ssr'
import { getPublicSupabaseEnv } from '@/lib/env'

let browserClient

/**
 * Browser Supabase client (client components, Realtime). Singleton per tab.
 */
export function getSupabaseBrowserClient() {
  if (typeof window === 'undefined') {
    throw new Error(
      'getSupabaseBrowserClient() must only run in the browser. Use createSupabaseServerClient from @/lib/supabase/server on the server.'
    )
  }
  if (!browserClient) {
    const { url, anonKey } = getPublicSupabaseEnv()
    browserClient = createBrowserClient(url, anonKey)
  }
  return browserClient
}
