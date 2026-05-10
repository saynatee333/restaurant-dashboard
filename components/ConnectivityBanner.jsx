'use client'

import { useOnlineStatus } from '@/hooks/useOnlineStatus'

export function ConnectivityBanner() {
  const online = useOnlineStatus()

  if (online) return null

  return (
    <div
      role="status"
      className="sticky top-0 z-50 border-b border-amber-800 bg-amber-950/95 px-4 py-2 text-center text-sm font-medium text-amber-100"
    >
      ออฟไลน์ — แสดงข้อมูลที่แคชไว้เมื่อมี · การสั่งงานอาจไม่สำเร็จจนกว่าเครือข่ายจะกลับมา
    </div>
  )
}
