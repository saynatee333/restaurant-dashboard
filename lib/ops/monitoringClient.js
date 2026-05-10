'use client'

/**
 * Fire-and-forget operational event from client.
 * Uses sendBeacon when available, with fetch fallback.
 * @param {string} event
 * @param {Record<string, unknown>} [meta]
 */
export function trackOperationalEvent(event, meta = {}) {
  if (typeof window === 'undefined') return
  try {
    const body = JSON.stringify({
      event,
      ts: new Date().toISOString(),
      meta,
    })

    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' })
      navigator.sendBeacon('/api/ops/events', blob)
      return
    }

    void fetch('/api/ops/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    })
  } catch {
    // ignore monitoring failures
  }
}
