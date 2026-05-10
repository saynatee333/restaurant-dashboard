'use client'

import { memo, useCallback, useEffect, useId, useMemo, useState } from 'react'

const QR_CELLS = 21 * 21

/** Pattern คงที่ตาม seed — คำนวณนอก React เพื่อความชัดเจนและทดย่อยได้ */
function deriveQrBits(seed) {
  let h = 2166136261
  const s = seed || 'default'
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const out = []
  for (let i = 0; i < QR_CELLS; i++) {
    h ^= h << 13
    h ^= h >>> 17
    h ^= h << 5
    out.push((h >>> (i % 24)) & 1)
  }
  return out
}

const SimulatedQrPattern = memo(function SimulatedQrPattern({ seed }) {
  const bits = useMemo(() => deriveQrBits(seed), [seed])

  return (
    <div
      className="mx-auto grid aspect-square max-h-[min(240px,55vw)] w-full max-w-[240px] gap-px rounded-lg bg-white p-2 shadow-inner"
      style={{ gridTemplateColumns: 'repeat(21, minmax(0, 1fr))' }}
      aria-hidden
    >
      {bits.map((bit, i) => (
        <div
          key={i}
          className={`aspect-square rounded-[1px] ${bit ? 'bg-slate-900' : 'bg-white'}`}
        />
      ))}
    </div>
  )
})

function useEscapeClose(open, onClose) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
}

/**
 * Flow PromptPay แบบจำลอง → `onConfirmPaid` ควรเรียก `payOrder(..., 'qr', ...)`
 */
export const PromptPayModal = memo(function PromptPayModal({
  open,
  onClose,
  orderId,
  totalBaht,
  formatBaht,
  busy,
  onConfirmPaid,
}) {
  const titleId = useId()
  const descId = useId()
  const [phase, setPhase] = useState('intro')
  const [innerBusy, setInnerBusy] = useState(false)

  useEffect(() => {
    if (!open) setPhase('intro')
  }, [open])

  useEscapeClose(open, onClose)

  const loading = busy || innerBusy

  const runPaid = useCallback(async () => {
    setInnerBusy(true)
    try {
      await onConfirmPaid()
      onClose()
    } finally {
      setInnerBusy(false)
    }
  }, [onConfirmPaid, onClose])

  const closeIfIdle = useCallback(() => {
    if (!loading) onClose()
  }, [loading, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/75 p-4 sm:items-center"
      role="presentation"
      onClick={closeIfIdle}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <h2 id={titleId} className="text-lg font-bold text-white">
            PromptPay <span className="text-emerald-400">(จำลอง)</span>
          </h2>
          <button
            type="button"
            disabled={loading}
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-40"
          >
            ปิด
          </button>
        </div>
        <p id={descId} className="mt-2 text-sm text-slate-400">
          จำลองการสแกนจ่ายด้วยพร้อมเพย์ — ในระบบจริงช่องนี้จะเป็น QR จาก payment gateway
        </p>

        <div className="mt-4 rounded-xl bg-slate-950/80 px-4 py-3 text-center">
          <p className="text-xs uppercase tracking-wide text-slate-500">ยอดชำระ</p>
          <p className="text-3xl font-bold tabular-nums text-emerald-400">
            ฿{formatBaht(totalBaht)}
          </p>
          <p className="mt-1 truncate font-mono text-xs text-slate-500">{orderId}</p>
        </div>

        {phase === 'intro' ? (
          <div className="mt-6 space-y-4">
            <p className="text-center text-sm text-slate-300">
              กดปุ่มด้านล่างเพื่อแสดง QR จำลองบนมือถือลูกค้า
            </p>
            <button
              type="button"
              disabled={loading}
              onClick={() => setPhase('qr')}
              className="flex min-h-14 w-full items-center justify-center rounded-xl bg-[#013087] text-base font-bold text-white hover:bg-[#012570] disabled:opacity-40"
            >
              แสดง QR PromptPay
            </button>
          </div>
        ) : (
          <div className="mt-6 space-y-5">
            <SimulatedQrPattern seed={orderId} />
            <p className="text-center text-xs text-slate-500">
              ลูกค้าสแกนจ่ายในแอปธนาคาร… (เดโม)
            </p>
            <button
              type="button"
              disabled={loading}
              onClick={() => void runPaid()}
              className="flex min-h-14 w-full items-center justify-center rounded-xl bg-emerald-600 text-base font-bold text-white hover:bg-emerald-500 disabled:opacity-40"
            >
              {loading ? 'กำลังบันทึก…' : 'จำลอง: ชำระสำเร็จ'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
})
