'use client'

import { useEffect } from 'react'

export default function GlobalErrorBoundary({ error, reset }) {
  useEffect(() => {
    console.error('Unhandled route error:', error)
  }, [error])

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100">
      <div className="w-full max-w-lg rounded-2xl border border-red-900 bg-red-950/30 p-6">
        <h1 className="text-xl font-bold text-red-100">เกิดข้อผิดพลาดที่ไม่คาดคิด</h1>
        <p className="mt-2 text-sm text-red-200/90">
          ระบบพยายามกู้คืนให้แล้ว หากยังไม่สำเร็จให้ลองใหม่อีกครั้ง
        </p>
        <button
          type="button"
          onClick={() => reset()}
          className="mt-4 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600"
        >
          ลองใหม่
        </button>
      </div>
    </main>
  )
}
