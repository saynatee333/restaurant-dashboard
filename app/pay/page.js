'use client'

import Link from 'next/link'
import { Suspense, memo, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { PromptPayModal } from '@/components/payment/PromptPayModal'
import { formatBaht } from '@/lib/formatBaht'
import { assertRpcOk } from '@/lib/supabaseRpc'
import {
  fetchOrderWithTableCode,
  fetchPaymentsByOrder,
  payOrder,
} from '@/lib/supabase'
import { requireUuid } from '@/lib/validation/input'

async function loadPayBundle(orderId) {
  const o = await fetchOrderWithTableCode(orderId)
  if (o.error) {
    return { ok: false, message: o.error.message, order: null, payments: null }
  }
  if (!o.data) {
    return { ok: false, message: 'ไม่พบออเดอร์', order: null, payments: null }
  }
  const pr = await fetchPaymentsByOrder(o.data.id)
  const payments = pr.error ? [] : pr.data || []
  return { ok: true, order: o.data, payments }
}

const PayToast = memo(function PayToast({ toast }) {
  if (!toast) return null
  return (
    <p
      role="status"
      className={`rounded-lg px-3 py-2 text-sm font-medium ${
        toast.type === 'ok'
          ? 'bg-emerald-950 text-emerald-100'
          : 'bg-red-950 text-red-200'
      }`}
    >
      {toast.text}
    </p>
  )
})

const PaymentRows = memo(function PaymentRows({ payments }) {
  if (!payments?.length) return null
  return (
    <div className="border-t border-slate-800 pt-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        ตาราง payments
      </p>
      <ul className="mt-2 space-y-2 text-sm">
        {payments.map((p) => (
          <li
            key={p.id}
            className="flex flex-wrap justify-between gap-2 border-b border-white/5 pb-2 text-slate-300"
          >
            <span className="uppercase text-cyan-300">{p.method}</span>
            <span className="tabular-nums">฿{formatBaht(p.amount)}</span>
            <span className="text-slate-500">{p.reference || '—'}</span>
          </li>
        ))}
      </ul>
    </div>
  )
})

const PayActions = memo(function PayActions({
  order,
  payable,
  busy,
  onOpenPrompt,
}) {
  if (payable) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={onOpenPrompt}
        className="flex min-h-14 w-full items-center justify-center rounded-xl bg-[#013087] text-base font-bold text-white hover:bg-[#012570] disabled:opacity-40"
      >
        ชำระด้วย PromptPay (จำลอง QR)
      </button>
    )
  }
  if (order.status === 'paid') {
    return <p className="text-emerald-300">ออเดอร์นี้ชำระแล้ว</p>
  }
  return (
    <p className="text-amber-200">
      ชำระได้เมื่อออเดอร์เป็น <strong>confirmed</strong> เท่านั้น (หลังส่งครัว)
    </p>
  )
})

const OrderDetailCard = memo(function OrderDetailCard({
  order,
  toast,
  payable,
  busy,
  payments,
  onOpenPrompt,
}) {
  return (
    <div className="mt-8 space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="flex justify-between text-sm text-slate-400">
        <span>สถานะ</span>
        <span className="font-semibold text-white">{order.status}</span>
      </div>
      <div className="flex justify-between text-sm text-slate-400">
        <span>ยอดรวม</span>
        <span className="text-xl font-bold tabular-nums text-emerald-400">
          ฿{formatBaht(order.total_amount)}
        </span>
      </div>
      {order.table_code ? (
        <p className="text-sm text-slate-500">
          โต๊ะ{' '}
          <Link
            className="text-emerald-400"
            href={`/status?table=${encodeURIComponent(order.table_code)}`}
          >
            {order.table_code}
          </Link>
        </p>
      ) : null}

      <PayToast toast={toast} />

      <PayActions order={order} payable={payable} busy={busy} onOpenPrompt={onOpenPrompt} />

      <PaymentRows payments={payments} />
    </div>
  )
})

export default function PayPage() {
  return (
    <Suspense fallback={<PayFallback />}>
      <PayContent />
    </Suspense>
  )
}

function PayFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center bg-slate-950 px-4 text-slate-400">
      กำลังโหลด…
    </div>
  )
}

function PayContent() {
  const searchParams = useSearchParams()
  const orderId = (searchParams.get('order') || '').trim()

  const [order, setOrder] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [promptOpen, setPromptOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)
  /** @type {Array<Record<string, unknown>> | null} */
  const [payments, setPayments] = useState(null)

  const reload = useCallback(async () => {
    if (!orderId) {
      setOrder(null)
      setLoadError(null)
      setPayments(null)
      setLoading(false)
      return
    }
    let safeOrderId = ''
    try {
      safeOrderId = requireUuid(orderId, 'order')
    } catch (e) {
      setOrder(null)
      setPayments(null)
      setLoadError(e.message || 'order id ไม่ถูกต้อง')
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError(null)
    const bundle = await loadPayBundle(safeOrderId)
    if (!bundle.ok) {
      setLoadError(bundle.message)
      setOrder(null)
      setPayments(null)
    } else {
      setOrder(bundle.order)
      setPayments(bundle.payments)
    }
    setLoading(false)
  }, [orderId])

  useEffect(() => {
    void reload()
  }, [reload])

  const completePromptPay = useCallback(async () => {
    if (!order || order.status !== 'confirmed') return
    const amt = Number(order.total_amount)
    const ref = `PP-SIM-${Date.now()}`
    assertRpcOk(await payOrder(order.id, 'qr', amt, ref))
    const pr = await fetchPaymentsByOrder(order.id)
    if (!pr.error) setPayments(pr.data || [])
    setToast({ type: 'ok', text: 'ชำระ PromptPay สำเร็จ · ออเดอร์เป็น paid แล้ว' })
    await reload()
  }, [order, reload])

  const payable = order?.status === 'confirmed'

  const closeModal = useCallback(() => {
    if (!busy) setPromptOpen(false)
  }, [busy])

  const confirmModalPaid = useCallback(async () => {
    setBusy(true)
    setToast(null)
    try {
      await completePromptPay()
      setPromptOpen(false)
    } catch (e) {
      setToast({ type: 'err', text: e.message || 'ชำระไม่สำเร็จ' })
      throw e
    } finally {
      setBusy(false)
    }
  }, [completePromptPay])

  const modalOpen = promptOpen && payable && Boolean(order)

  return (
    <main className="min-h-dvh bg-slate-950 px-4 py-8 text-slate-100">
      <div className="mx-auto max-w-md">
        <Link href="/menu" className="text-sm text-emerald-400 hover:text-emerald-300">
          ← เมนู
        </Link>
        <h1 className="mt-4 text-2xl font-bold text-white">ชำระเงิน</h1>
        <p className="mt-2 text-sm text-slate-400">
          เพจสำหรับทดสอบลิงก์ชำระ · ใช้พารามิเตอร์{' '}
          <code className="rounded bg-slate-800 px-1">?order=uuid</code>
        </p>

        {!orderId ? (
          <p className="mt-8 rounded-xl border border-amber-900/50 bg-amber-950/30 p-4 text-amber-100">
            ไม่มีรหัสออเดอร์ใน URL — ตัวอย่าง{' '}
            <code className="break-all text-xs">
              /pay?order=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
            </code>
          </p>
        ) : null}

        {loading ? <p className="mt-8 text-slate-500">กำลังโหลดออเดอร์…</p> : null}
        {loadError ? (
          <p className="mt-8 rounded-xl border border-red-900 bg-red-950/40 p-4 text-red-100">
            {loadError}
            <button
              type="button"
              onClick={() => void reload()}
              className="mt-3 block rounded-lg border border-red-700 px-3 py-1.5 text-sm hover:bg-red-900/40"
            >
              ลองโหลดอีกครั้ง
            </button>
          </p>
        ) : null}

        {!loading && order && !loadError ? (
          <OrderDetailCard
            order={order}
            toast={toast}
            payable={payable}
            busy={busy}
            payments={payments}
            onOpenPrompt={() => setPromptOpen(true)}
          />
        ) : null}
      </div>

      <PromptPayModal
        open={modalOpen}
        onClose={closeModal}
        orderId={order?.id || ''}
        totalBaht={order ? Number(order.total_amount) : 0}
        formatBaht={formatBaht}
        busy={busy}
        onConfirmPaid={confirmModalPaid}
      />
    </main>
  )
}
