'use client'

import { useEffect, useState } from 'react'

/**
 * Best-effort online flag: `navigator.onLine` can be wrong (Wi‑Fi captive portal, browser bugs).
 * When the browser reports offline, we verify with a same-origin ping.
 */
export function useOnlineStatus() {
  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine
  )

  useEffect(() => {
    let cancelled = false

    async function reconcile() {
      if (typeof window === 'undefined' || cancelled) return
      if (navigator.onLine) {
        setOnline(true)
        return
      }
      try {
        const res = await fetch('/api/v1/ping', { cache: 'no-store' })
        if (!cancelled) setOnline(res.ok)
      } catch {
        if (!cancelled) setOnline(false)
      }
    }

    void reconcile()
    window.addEventListener('online', reconcile)
    window.addEventListener('offline', reconcile)
    const interval = setInterval(reconcile, 20_000)

    return () => {
      cancelled = true
      window.removeEventListener('online', reconcile)
      window.removeEventListener('offline', reconcile)
      clearInterval(interval)
    }
  }, [])

  return online
}
