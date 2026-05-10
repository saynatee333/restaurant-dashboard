'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo } from 'react'
import { allowedRolesForPath, normalizeRole } from '@/lib/roles'
import { useBranchContext } from '@/context/BranchContext'

/**
 * RBAC ฝั่ง client (หลัง middleware เช็คล็อกอินแล้ว)
 * ถ้า path ไม่อยู่ในกฎ → ไม่บังคับบทบาท (เช่น `/menu`)
 */
export function RoleGate({ children }) {
  const pathname = usePathname()
  const router = useRouter()
  const { loading, authIssue, profile, reload } = useBranchContext()

  const allowedRoles = useMemo(() => allowedRolesForPath(pathname), [pathname])

  const normalizedRole = useMemo(
    () => (profile?.role != null ? normalizeRole(profile.role) : null),
    [profile?.role]
  )

  const accessDenied =
    allowedRoles !== null &&
    normalizedRole !== null &&
    !allowedRoles.includes(normalizedRole)

  useEffect(() => {
    if (loading || allowedRoles === null || !profile || !accessDenied) return
    router.replace('/dashboard')
  }, [loading, allowedRoles, profile, accessDenied, router])

  useEffect(() => {
    if (loading || allowedRoles === null || profile || authIssue !== 'login') return
    const dest = `/login?next=${encodeURIComponent(pathname)}`
    router.replace(dest)
  }, [loading, allowedRoles, profile, authIssue, router, pathname])

  if (allowedRoles === null) return children

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-slate-400">
        กำลังโหลดสิทธิ์…
      </div>
    )
  }

  if (!profile && authIssue === 'login') {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 px-4 text-center text-slate-400">
        <p>กำลังพาไปหน้าเข้าสู่ระบบ…</p>
      </div>
    )
  }

  if (!profile && authIssue === 'error') {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 px-4 text-center text-slate-300">
        <p className="max-w-md text-sm">
          โหลดสิทธิ์ไม่สำเร็จ (เซิร์ฟเวอร์หรือเครือข่าย) — ลองใหม่หรือเข้าสู่ระบบอีกครั้ง
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
            onClick={() => void reload()}
          >
            ลองใหม่
          </button>
          <button
            type="button"
            className="rounded-xl border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
            onClick={() =>
              router.replace(`/login?next=${encodeURIComponent(pathname)}`)
            }
          >
            ไปหน้าเข้าสู่ระบบ
          </button>
        </div>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-slate-400">
        กำลังโหลดสิทธิ์…
      </div>
    )
  }

  if (accessDenied) return null

  return children
}
