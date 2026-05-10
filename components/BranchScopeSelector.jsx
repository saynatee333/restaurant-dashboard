'use client'

import { useCallback, useMemo } from 'react'
import { useBranchContext } from '@/context/BranchContext'

/** เลือกสาขาสำหรับแอดมินเท่านั้น — ค่าอยู่ใน sessionStorage ผ่าน BranchProvider */
export function BranchScopeSelector() {
  const { loading, profile, branches, effectiveBranchId, setAdminBranchScope } =
    useBranchContext()

  const show = useMemo(
    () => Boolean(!loading && profile?.role === 'admin' && branches?.length),
    [loading, profile?.role, branches?.length]
  )

  const onBranchChange = useCallback(
    (e) => {
      const v = e.target.value
      setAdminBranchScope(v ? v : null)
    },
    [setAdminBranchScope]
  )

  if (!show) return null

  return (
    <label className="flex flex-wrap items-center gap-2 text-sm text-slate-400">
      สาขา (มุมมอง)
      <select
        value={effectiveBranchId ?? ''}
        onChange={onBranchChange}
        className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white"
      >
        <option value="">ทุกสาขา</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.code} — {b.name}
          </option>
        ))}
      </select>
    </label>
  )
}
