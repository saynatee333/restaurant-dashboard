/** Client-only cache for dashboard RPC summary when offline */

const PREFIX = 'rd-dash-summary:'

/** @param {string} dayIso YYYY-MM-DD */
export function saveDashboardSummaryCache(dayIso, summary) {
  if (typeof window === 'undefined') return
  try {
    const key = PREFIX + dayIso
    window.sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), summary }))
  } catch {
    /* quota / private mode */
  }
}

/** @param {string} dayIso */
export function loadDashboardSummaryCache(dayIso) {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(PREFIX + dayIso)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.summary ?? null
  } catch {
    return null
  }
}
