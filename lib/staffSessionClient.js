/** คีย์ sessionStorage สำหรับมุมมองสาขาของแอดมิน */
import { withRetry } from '@/lib/network/retry'

export const ADMIN_BRANCH_SCOPE_KEY = 'rd-branch-scope'

export function readAdminBranchScope() {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage.getItem(ADMIN_BRANCH_SCOPE_KEY)
  } catch {
    return null
  }
}

/** @param {string | null} id */
export function writeAdminBranchScope(id) {
  if (typeof window === 'undefined') return
  try {
    if (id) window.sessionStorage.setItem(ADMIN_BRANCH_SCOPE_KEY, id)
    else window.sessionStorage.removeItem(ADMIN_BRANCH_SCOPE_KEY)
  } catch {
    /* quota / private mode */
  }
}

/**
 * ดึงโปรไฟล์พนักงานจาก API (ใช้ใน client เท่านั้น)
 * @returns {Promise<
 *   | { ok: true, profile: Record<string, unknown>, branches: unknown[] }
 *   | { ok: false, reason: 'unauthorized' | 'error', status?: number }
 * >}
 */
export async function fetchStaffMeFromApi() {
  const res = await withRetry(() => {
    const ctrl = new AbortController()
    const tid = setTimeout(() => ctrl.abort(), 8000)
    return fetch('/api/me', {
      credentials: 'include',
      cache: 'no-store',
      signal: ctrl.signal,
    }).finally(() => clearTimeout(tid))
  }, { retries: 1 })
  const json = await res.json().catch(() => ({}))

  if (res.status === 401) {
    return { ok: false, reason: 'unauthorized', status: 401 }
  }
  if (!res.ok || !json.ok) {
    return { ok: false, reason: 'error', status: res.status }
  }

  const profile = json.profile
  if (!profile || typeof profile !== 'object') {
    return { ok: false, reason: 'error', status: res.status }
  }

  return {
    ok: true,
    profile,
    branches: Array.isArray(json.branches) ? json.branches : [],
  }
}
