import { NextResponse } from 'next/server'
import { getPublicSupabaseEnv, getServiceRoleKey } from '@/lib/env'
import { logInfo, logWarn } from '@/lib/logger'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

/** When service role is not set, still verify anon key + project via GoTrue health (RLS-neutral). */
async function probeSupabaseAuthHealth({ url, anonKey }) {
  const base = url.replace(/\/$/, '')
  const res = await fetch(`${base}/auth/v1/health`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    cache: 'no-store',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { ok: false, error: `auth health HTTP ${res.status}: ${text.slice(0, 200)}` }
  }
  return { ok: true, error: null }
}

export async function GET() {
  const hasSupabase =
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const hasServiceRole = Boolean(getServiceRoleKey())

  let upstreamReachable = false
  let dbError = null
  /** @type {'service_role_orders'|'anon_auth_health'|null} */
  let upstreamProbe = null

  if (hasSupabase) {
    if (hasServiceRole) {
      upstreamProbe = 'service_role_orders'
      try {
        const admin = createSupabaseAdminClient()
        const { error } = await admin.from('orders').select('id').limit(1)
        if (error) {
          dbError = error.message
        } else {
          upstreamReachable = true
        }
      } catch (e) {
        dbError = e instanceof Error ? e.message : String(e)
      }
    } else {
      upstreamProbe = 'anon_auth_health'
      try {
        const { url, anonKey } = getPublicSupabaseEnv()
        const r = await probeSupabaseAuthHealth({ url, anonKey })
        if (r.ok) {
          upstreamReachable = true
        } else {
          dbError = r.error ?? 'auth health probe failed'
        }
      } catch (e) {
        dbError = e instanceof Error ? e.message : String(e)
      }
    }
  }

  const health = {
    ok: hasSupabase && upstreamReachable,
    timestamp: new Date().toISOString(),
    supabaseConfigured: hasSupabase,
    serviceRoleConfigured: hasServiceRole,
    upstreamReachable,
    upstreamProbe,
    upstreamError: dbError,
    /** @deprecated Prefer upstreamReachable; kept for older monitors expecting this shape */
    databaseReachable: upstreamReachable,
    databaseError: dbError,
    uptimeSec: Math.floor(process.uptime()),
  }

  if (!health.ok) {
    logWarn('health_check', health)
  } else {
    logInfo('health_check', health)
  }

  return NextResponse.json(health, { status: health.ok ? 200 : 503 })
}
