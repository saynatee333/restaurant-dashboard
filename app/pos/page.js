'use client'

import Link from 'next/link'
import {
  Suspense,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useSearchParams } from 'next/navigation'
import { PromptPayModal } from '@/components/payment/PromptPayModal'
import { RoleGate } from '@/components/RoleGate'
import { useBranchContext } from '@/context/BranchContext'
import {
  ORDERS_REALTIME_CHANNEL,
  ORDERS_REALTIME_DEBOUNCE_MS,
  useSupabaseOrdersRealtime,
} from '@/hooks/useSupabaseOrdersRealtime'
import { usePosOfflineSync } from '@/hooks/usePosOfflineSync'
import { formatBaht } from '@/lib/formatBaht'
import { formatUnknownError } from '@/lib/formatUnknownError'
import {
  enqueuePosOfflineAction,
  loadPosProductsCache,
  savePosProductsCache,
} from '@/lib/offline/posOfflineStorage'
import { assertRpcOk } from '@/lib/supabaseRpc'
import {
  addItemToOrder,
  createOrder,
  fetchPaymentsByOrder,
  fetchProducts,
  payOrder,
  submitOrder,
} from '@/lib/supabase'

const TH_LOCALE = 'th'
const DEFAULT_CATEGORY_LABEL = 'ทั่วไป'
const ALL_CATEGORY = ''

const INPUT_LG_CLASS =
  'min-h-14 rounded-xl border border-slate-600 bg-slate-900 px-4 text-lg text-white outline-none ring-emerald-500/40 placeholder:text-slate-600 focus:border-emerald-500 focus-visible:ring-2'

function normalizeCategory(product) {
  const c = (product.category || '').trim()
  return c || DEFAULT_CATEGORY_LABEL
}

function isTypingTarget(el) {
  if (!el || !(el instanceof HTMLElement)) return false
  const tag = el.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable
  )
}

function buildCategoryTabs(products) {
  const keys = new Set()
  for (const p of products) {
    keys.add(normalizeCategory(p))
  }
  const sorted = Array.from(keys).sort((a, b) => a.localeCompare(b, TH_LOCALE))
  return [ALL_CATEGORY, ...sorted]
}

function filterProducts(products, query, categoryKey) {
  const q = query.trim().toLowerCase()
  return products.filter((p) => {
    if (categoryKey && normalizeCategory(p) !== categoryKey) return false
    if (!q) return true
    return (p.name || '').toLowerCase().includes(q)
  })
}

function cartLinesSorted(cart) {
  return Object.values(cart).sort((a, b) =>
    a.name.localeCompare(b.name, TH_LOCALE)
  )
}

function cartSum(cart) {
  let sum = 0
  for (const line of Object.values(cart)) {
    sum += Number(line.price || 0) * line.qty
  }
  return sum
}

/** --- Presentational (memo): product grid skips re-render when only cart changes --- */

const ProductCard = memo(function ProductCard({ product, onAdd }) {
  const cat = (product.category || '').trim()
  return (
    <button
      type="button"
      onClick={() => onAdd(product)}
      className="flex min-h-[120px] flex-col items-start rounded-2xl border border-slate-700 bg-slate-900/80 p-4 text-left outline-none ring-emerald-500/30 transition hover:border-emerald-600/60 hover:bg-slate-800 active:scale-[0.98] focus-visible:ring-2"
    >
      <span className="text-lg font-bold leading-snug text-white">{product.name}</span>
      <span className="mt-auto pt-3 text-xl font-semibold text-emerald-400">
        ฿{formatBaht(product.price)}
      </span>
      {cat ? <span className="mt-1 text-xs text-slate-500">{product.category}</span> : null}
    </button>
  )
})

const ProductGrid = memo(function ProductGrid({ products, onAdd }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-3 xl:grid-cols-4">
      {products.map((p) => (
        <ProductCard key={p.id} product={p} onAdd={onAdd} />
      ))}
    </div>
  )
})

const CartLineRow = memo(function CartLineRow({ line, busy, onBump, onRemove }) {
  const productStub = { id: line.id, name: line.name, price: line.price }
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-slate-700 bg-slate-950/60 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <p className="truncate text-lg font-semibold text-white">{line.name}</p>
        <p className="text-sm text-slate-400">
          ฿{formatBaht(line.price)} × {line.qty} = ฿{formatBaht(line.price * line.qty)}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-label={`ลด ${line.name}`}
          disabled={busy}
          onClick={() => onBump(productStub, -1)}
          className="flex h-14 min-w-14 items-center justify-center rounded-xl bg-slate-700 text-2xl font-bold text-white hover:bg-slate-600 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
        >
          −
        </button>
        <span className="min-w-[2ch] text-center text-xl font-bold tabular-nums text-white">
          {line.qty}
        </span>
        <button
          type="button"
          aria-label={`เพิ่ม ${line.name}`}
          disabled={busy}
          onClick={() => onBump(productStub, 1)}
          className="flex h-14 min-w-14 items-center justify-center rounded-xl bg-slate-700 text-2xl font-bold text-white hover:bg-slate-600 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
        >
          +
        </button>
        <button
          type="button"
          aria-label={`ลบ ${line.name} ออกจากตะกร้า`}
          disabled={busy}
          onClick={() => onRemove(line.id)}
          className="min-h-12 rounded-xl border border-red-900 bg-red-950/50 px-4 text-base font-semibold text-red-200 hover:bg-red-900/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400"
        >
          ลบ
        </button>
      </div>
    </li>
  )
})

const CategoryTabList = memo(function CategoryTabList({
  categories,
  activeKey,
  onSelect,
}) {
  const LABEL_ALL = 'ทั้งหมด'

  const onKeyDown = useCallback(
    (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
      e.preventDefault()
      const i = categories.indexOf(activeKey)
      if (i < 0) return
      const next =
        e.key === 'ArrowRight'
          ? Math.min(i + 1, categories.length - 1)
          : Math.max(i - 1, 0)
      onSelect(categories[next])
      const el = e.currentTarget.querySelector(`[data-cat-idx="${next}"]`)
      if (el instanceof HTMLElement) el.focus()
    },
    [categories, activeKey, onSelect]
  )

  return (
    <div
      className="mt-4 flex snap-x gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="tablist"
      aria-label="หมวดหมู่"
      onKeyDown={onKeyDown}
    >
      {categories.map((cat, idx) => {
        const active = activeKey === cat
        const label = cat === ALL_CATEGORY ? LABEL_ALL : cat
        return (
          <button
            key={cat || 'all'}
            type="button"
            role="tab"
            data-cat-idx={idx}
            aria-selected={active}
            onClick={() => onSelect(cat)}
            className={`snap-start whitespace-nowrap rounded-full px-5 py-3 text-base font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-emerald-500 ${
              active
                ? 'bg-emerald-500 text-slate-950'
                : 'border border-slate-600 bg-slate-900 text-slate-200 hover:bg-slate-800'
            }`}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
})

const PaymentPanel = memo(function PaymentPanel({
  total,
  payRef,
  onPayRefChange,
  busy,
  onPay,
  onPromptPay,
}) {
  return (
    <div className="mt-6 rounded-2xl border border-amber-700/50 bg-amber-950/25 p-4">
      <p className="text-sm font-medium text-amber-200/90">ชำระเงิน</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-white">฿{formatBaht(total)}</p>
      <button
        type="button"
        disabled={busy}
        onClick={onPromptPay}
        className="mt-4 flex min-h-14 w-full items-center justify-center rounded-xl bg-[#013087] text-base font-bold text-white hover:bg-[#012570] disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
      >
        ชำระด้วย PromptPay (จำลอง QR)
      </button>
      <label className="mt-4 flex flex-col gap-1 text-sm text-amber-100/80">
        <span>อ้างอิง (ไม่บังคับ)</span>
        <input
          value={payRef}
          onChange={(e) => onPayRefChange(e.target.value)}
          className="min-h-12 rounded-xl border border-amber-900/60 bg-slate-950 px-3 text-base text-white outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          placeholder="เลขอ้างอิง / เลขที่สลิป"
        />
      </label>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { method: 'cash', label: 'เงินสด', className: 'bg-slate-100 text-slate-900 hover:bg-white' },
          { method: 'card', label: 'บัตร', className: 'bg-indigo-600 text-white hover:bg-indigo-500' },
          { method: 'qr', label: 'QR', className: 'bg-cyan-600 text-white hover:bg-cyan-500' },
        ].map(({ method, label, className }) => (
          <button
            key={method}
            type="button"
            disabled={busy}
            onClick={() => onPay(method)}
            className={`min-h-16 rounded-xl text-lg font-bold disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 ${className}`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-500">
        PromptPay เรียก <code className="rounded bg-black/30 px-1">pos_payment_callback</code> method{' '}
        <code className="rounded bg-black/30 px-1">qr</code> · ยอดต้องตรงยอดรวม · ออเดอร์ต้องเป็น{' '}
        <code className="rounded bg-black/30 px-1">confirmed</code>
      </p>
    </div>
  )
})

const PaymentsReceipt = memo(function PaymentsReceipt({
  payments,
  tableCode,
  formatBaht: fmt,
  onDismiss,
}) {
  return (
    <div className="mt-4 rounded-2xl border border-emerald-800/60 bg-emerald-950/25 p-4">
      <p className="text-sm font-semibold text-emerald-200">บันทึกใน payments</p>
      <ul className="mt-2 space-y-2 text-sm text-slate-200">
        {payments.map((p) => (
          <li
            key={p.id}
            className="flex flex-wrap justify-between gap-2 border-b border-white/5 pb-2 last:border-0"
          >
            <span className="font-mono text-xs text-slate-400">{String(p.id).slice(0, 8)}…</span>
            <span className="uppercase text-amber-200/90">{p.method}</span>
            <span className="tabular-nums">฿{fmt(p.amount)}</span>
            <span className="text-slate-500">{p.reference || '—'}</span>
            <span className="text-emerald-400">{p.status}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={`/status?table=${encodeURIComponent(tableCode.trim())}`}
          className="inline-flex min-h-11 items-center rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-500"
        >
          สถานะโต๊ะ
        </Link>
        <button
          type="button"
          onClick={onDismiss}
          className="min-h-11 rounded-xl border border-slate-600 px-4 text-sm font-medium text-slate-300 hover:bg-slate-800"
        >
          ปิด
        </button>
      </div>
    </div>
  )
})

export default function POSPage() {
  return (
    <Suspense fallback={<PosFallback />}>
      <RoleGate>
        <POSContent />
      </RoleGate>
    </Suspense>
  )
}

function PosFallback() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <p className="text-lg text-slate-400">กำลังโหลด POS…</p>
    </main>
  )
}

function POSContent() {
  const searchParams = useSearchParams()
  const { effectiveBranchId } = useBranchContext()
  const { online, syncing, pendingCount, refreshQueueCount, syncNow } = usePosOfflineSync()
  const searchRef = useRef(null)
  const tableInputRef = useRef(null)

  const [products, setProducts] = useState([])
  const [loadError, setLoadError] = useState(null)
  const [loadingProducts, setLoadingProducts] = useState(true)

  const [query, setQuery] = useState('')
  const [category, setCategory] = useState(ALL_CATEGORY)
  const [tableCode, setTableCode] = useState('')

  /** @type {Record<string, { id: string, name: string, price: number, qty: number }>} */
  const [cart, setCart] = useState({})

  const [toast, setToast] = useState(null)
  const [busy, setBusy] = useState(false)

  const [payable, setPayable] = useState(null)
  const [payRef, setPayRef] = useState('')
  const [promptPayOpen, setPromptPayOpen] = useState(false)
  /** @type {Array<Record<string, unknown>> | null} */
  const [recentPayments, setRecentPayments] = useState(null)

  useEffect(() => {
    const t = searchParams.get('table')
    if (t) setTableCode(t.trim())
  }, [searchParams])

  const loadProducts = useCallback(async () => {
    setLoadingProducts(true)
    setLoadError(null)
    if (!online) {
      const cached = loadPosProductsCache(effectiveBranchId || null)
      if (cached?.length) {
        setProducts(cached)
        setLoadingProducts(false)
        return
      }
      setProducts([])
      setLoadError('ออฟไลน์และไม่พบแคชเมนูสำหรับสาขานี้')
      setLoadingProducts(false)
      return
    }

    const { data, error } = await fetchProducts({
      limit: 500,
      branchId: effectiveBranchId || undefined,
    })
    if (error) {
      const cached = loadPosProductsCache(effectiveBranchId || null)
      if (cached?.length) {
        setProducts(cached)
        setLoadError(
          `ใช้เมนูแคชแทน เพราะโหลดออนไลน์ไม่สำเร็จ: ${formatUnknownError(error)}`
        )
      } else {
        setLoadError(formatUnknownError(error))
        setProducts([])
      }
    } else {
      setProducts(data || [])
      savePosProductsCache(effectiveBranchId || null, data || [])
    }
    setLoadingProducts(false)
  }, [effectiveBranchId, online])

  useEffect(() => {
    loadProducts()
  }, [loadProducts])

  useSupabaseOrdersRealtime(loadProducts, {
    debounceMs: ORDERS_REALTIME_DEBOUNCE_MS.pos,
    channelName: ORDERS_REALTIME_CHANNEL.pos,
  })

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 4200)
    return () => clearTimeout(id)
  }, [toast])

  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented) return
      if (e.key === '/' && !isTypingTarget(document.activeElement) && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        searchRef.current?.focus()
      }
      if (e.key === 'Escape') {
        setQuery('')
        searchRef.current?.blur()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const categories = useMemo(() => buildCategoryTabs(products), [products])

  const filteredProducts = useMemo(
    () => filterProducts(products, query, category),
    [products, query, category]
  )

  const lines = useMemo(() => cartLinesSorted(cart), [cart])
  const cartTotal = useMemo(() => cartSum(cart), [cart])

  const bumpQty = useCallback((product, delta) => {
    const id = product.id
    setCart((prev) => {
      const cur = prev[id]
      const nextQty = (cur?.qty || 0) + delta
      if (nextQty <= 0) {
        const { [id]: _, ...rest } = prev
        return rest
      }
      return {
        ...prev,
        [id]: {
          id,
          name: product.name,
          price: Number(product.price) || 0,
          qty: nextQty,
        },
      }
    })
  }, [])

  const addOne = useCallback((product) => bumpQty(product, 1), [bumpQty])

  const removeLine = useCallback((productId) => {
    setCart((prev) => {
      const { [productId]: _, ...rest } = prev
      return rest
    })
  }, [])

  const clearCart = useCallback(() => setCart({}), [])

  const handleSubmitOrder = useCallback(async () => {
    const code = tableCode.trim()
    if (!code) {
      setToast({ type: 'err', text: 'ใส่รหัสโต๊ะก่อน (หรือ ?table=… ใน URL)' })
      tableInputRef.current?.focus()
      return
    }
    if (lines.length === 0) {
      setToast({ type: 'err', text: 'เลือกสินค้าอย่างน้อย 1 รายการ' })
      return
    }

    setBusy(true)
    setToast(null)
    try {
      if (!online) {
        enqueuePosOfflineAction({
          type: 'CREATE_ORDER_FLOW',
          branchId: effectiveBranchId || null,
          payload: {
            tableCode: code,
            lines: lines.map((x) => ({ id: x.id, qty: x.qty, name: x.name, price: x.price })),
          },
        })
        clearCart()
        setRecentPayments(null)
        refreshQueueCount()
        setToast({
          type: 'ok',
          text: 'บันทึกออเดอร์ออฟไลน์แล้ว · ระบบจะ sync อัตโนมัติเมื่อออนไลน์',
        })
        return
      }

      const created = assertRpcOk(await createOrder(code))
      const orderId = created.order_id

      for (const line of lines) {
        assertRpcOk(await addItemToOrder(orderId, line.id, line.qty))
      }

      const submitted = assertRpcOk(await submitOrder(orderId))
      const total = Number(submitted.total_amount)

      clearCart()
      setRecentPayments(null)
      setPayable({ orderId, total })
      setPayRef('')
      setToast({
        type: 'ok',
        text: `ส่งเข้าครัวแล้ว · ออเดอร์ ${String(orderId).slice(0, 8)}… · รวม ฿${formatBaht(total)}`,
      })
    } catch (e) {
      setToast({ type: 'err', text: e.message || 'ส่งออเดอร์ไม่สำเร็จ' })
    } finally {
      setBusy(false)
    }
  }, [tableCode, lines, clearCart, online, effectiveBranchId, refreshQueueCount])

  const finalizePaymentAndRefresh = useCallback(async (orderId) => {
    const { data, error } = await fetchPaymentsByOrder(orderId)
    if (error) console.error('fetchPaymentsByOrder', error)
    setRecentPayments(data?.length ? data : [])
    setPayable(null)
    setPromptPayOpen(false)
  }, [])

  const handlePay = useCallback(
    async (method) => {
      if (!payable) return
      setBusy(true)
      setToast(null)
      try {
        const body = assertRpcOk(
          await payOrder(payable.orderId, method, payable.total, payRef || null)
        )
        await finalizePaymentAndRefresh(payable.orderId)
        setToast({
          type: 'ok',
          text: `ชำระเงินสำเร็จ · payment ${String(body.payment_id || '').slice(0, 8)}…`,
        })
      } catch (e) {
        setToast({ type: 'err', text: e.message || 'ชำระไม่สำเร็จ' })
      } finally {
        setBusy(false)
      }
    },
    [payable, payRef, finalizePaymentAndRefresh]
  )

  const handlePromptPayConfirm = useCallback(async () => {
    if (!payable) return
    const oid = payable.orderId
    const amt = payable.total
    const ref = `PP-SIM-${Date.now()}`
    const body = assertRpcOk(await payOrder(oid, 'qr', amt, ref))
    await finalizePaymentAndRefresh(oid)
    setToast({
      type: 'ok',
      text: `PromptPay (จำลอง) สำเร็จ · payment ${String(body.payment_id || '').slice(0, 8)}…`,
    })
  }, [payable, finalizePaymentAndRefresh])

  return (
    <main className="flex min-h-screen flex-col bg-slate-950 lg:flex-row">
      <div aria-live="polite" className="sr-only">
        {toast?.text || ''}
      </div>

      <section className="flex min-h-[50vh] flex-1 flex-col border-b border-slate-800 lg:min-h-screen lg:border-b-0 lg:border-r">
        <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/95 px-4 py-3 backdrop-blur">
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/dashboard"
              className="inline-flex min-h-12 min-w-[44px] items-center justify-center rounded-xl border border-slate-600 px-4 text-base font-medium text-slate-300 outline-none ring-emerald-500/40 transition hover:bg-slate-800 focus-visible:ring-2"
            >
              ← กลับ
            </Link>
            <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl">POS</h1>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span
              className={`rounded-full px-2 py-1 font-medium ${
                online ? 'bg-emerald-950 text-emerald-300' : 'bg-amber-950 text-amber-300'
              }`}
            >
              {online ? 'Online' : 'Offline'}
            </span>
            {pendingCount > 0 ? (
              <>
                <span className="rounded-full bg-slate-800 px-2 py-1 text-slate-300">
                  รอ sync {pendingCount} รายการ
                </span>
                <button
                  type="button"
                  disabled={!online || syncing}
                  onClick={() => void syncNow()}
                  className="rounded-full border border-slate-600 px-2 py-1 text-slate-300 disabled:opacity-40"
                >
                  {syncing ? 'กำลัง sync…' : 'sync ตอนนี้'}
                </button>
              </>
            ) : null}
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex flex-1 flex-col gap-1 text-sm text-slate-400">
              <span className="font-medium text-slate-300">รหัสโต๊ะ</span>
              <input
                ref={tableInputRef}
                type="text"
                autoComplete="off"
                placeholder="เช่น T01"
                value={tableCode}
                onChange={(e) => setTableCode(e.target.value)}
                className={INPUT_LG_CLASS}
              />
            </label>
            <p className="text-xs text-slate-500">
              ลัด: <kbd className="rounded bg-slate-800 px-1.5 py-0.5">/</kbd> ค้นหา ·{' '}
              <kbd className="rounded bg-slate-800 px-1.5 py-0.5">Esc</kbd> เคลียร์ค้นหา
            </p>
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <label className="flex flex-1 flex-col gap-1 text-sm text-slate-400">
              <span className="font-medium text-slate-300">ค้นหา</span>
              <input
                ref={searchRef}
                type="search"
                autoComplete="off"
                placeholder="ชื่อเมนู…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className={INPUT_LG_CLASS}
              />
            </label>
          </div>

          <CategoryTabList categories={categories} activeKey={category} onSelect={setCategory} />
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          {loadingProducts && <p className="text-lg text-slate-500">กำลังโหลดเมนู…</p>}
          {loadError && (
            <div className="rounded-xl border border-red-900 bg-red-950/40 p-4 text-red-200">
              <p className="font-medium">โหลดเมนูไม่ได้</p>
              <p className="mt-1 text-sm opacity-90">{loadError}</p>
              <button
                type="button"
                onClick={loadProducts}
                className="mt-4 min-h-12 rounded-xl bg-red-900 px-5 text-base font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400"
              >
                ลองอีกครั้ง
              </button>
            </div>
          )}
          {!loadingProducts && !loadError && filteredProducts.length === 0 && (
            <p className="text-lg text-slate-500">ไม่พบรายการที่ตรงคำค้น</p>
          )}
          {!loadingProducts && !loadError && filteredProducts.length > 0 && (
            <ProductGrid products={filteredProducts} onAdd={addOne} />
          )}
        </div>
      </section>

      <aside className="flex w-full flex-col bg-slate-900 lg:w-[420px] lg:min-w-[380px] xl:w-[460px]">
        <div className="border-b border-slate-800 px-4 py-4">
          <h2 className="text-lg font-bold text-white">ตะกร้า</h2>
          {toast && (
            <p
              role="status"
              className={`mt-2 rounded-lg px-3 py-2 text-sm font-medium ${
                toast.type === 'ok'
                  ? 'bg-emerald-950 text-emerald-200'
                  : 'bg-red-950 text-red-200'
              }`}
            >
              {toast.text}
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {lines.length === 0 ? (
            <p className="text-base text-slate-500">ยังไม่มีรายการ · แตะเมนูเพื่อเพิ่ม</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {lines.map((line) => (
                <CartLineRow
                  key={line.id}
                  line={line}
                  busy={busy}
                  onBump={bumpQty}
                  onRemove={removeLine}
                />
              ))}
            </ul>
          )}
        </div>

        <footer className="border-t border-slate-800 bg-slate-950/90 px-4 py-4 backdrop-blur">
          <div className="flex items-baseline justify-between gap-4 border-b border-slate-800 pb-4">
            <span className="text-lg font-medium text-slate-400">รวม</span>
            <span className="text-3xl font-bold tabular-nums text-emerald-400">
              ฿{formatBaht(cartTotal)}
            </span>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || lines.length === 0}
              onClick={clearCart}
              className="min-h-14 flex-1 rounded-xl border border-slate-600 bg-slate-800 px-4 text-base font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
            >
              เคลียร์ตะกร้า
            </button>
          </div>

          <button
            type="button"
            disabled={busy || lines.length === 0 || !!payable}
            onClick={handleSubmitOrder}
            className="mt-3 flex w-full min-h-16 items-center justify-center rounded-2xl bg-emerald-600 text-xl font-bold text-white shadow-lg shadow-emerald-900/30 hover:bg-emerald-500 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
          >
            {busy ? 'กำลังส่ง…' : 'ส่งเข้าครัว (ยืนยันออเดอร์)'}
          </button>

          {payable ? (
            <PaymentPanel
              total={payable.total}
              payRef={payRef}
              onPayRefChange={setPayRef}
              busy={busy}
              onPay={handlePay}
              onPromptPay={() => setPromptPayOpen(true)}
            />
          ) : null}

          {recentPayments?.length ? (
            <PaymentsReceipt
              payments={recentPayments}
              tableCode={tableCode}
              formatBaht={formatBaht}
              onDismiss={() => setRecentPayments(null)}
            />
          ) : null}
        </footer>
      </aside>

      <PromptPayModal
        open={promptPayOpen && Boolean(payable)}
        onClose={() => !busy && setPromptPayOpen(false)}
        orderId={payable?.orderId || ''}
        totalBaht={payable?.total ?? 0}
        formatBaht={formatBaht}
        busy={busy}
        onConfirmPaid={async () => {
          setBusy(true)
          setToast(null)
          try {
            await handlePromptPayConfirm()
          } catch (e) {
            setToast({ type: 'err', text: e.message || 'ชำระไม่สำเร็จ' })
            throw e
          } finally {
            setBusy(false)
          }
        }}
      />
    </main>
  )
}
