'use client'

import Link from 'next/link'
import {
  Suspense,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { addItemToOrder, createOrder, submitOrder, supabase } from '@/lib/supabase'
import { formatUnknownError } from '@/lib/formatUnknownError'
import { requireTableCode } from '@/lib/validation/input'

const TH = 'th'
const DEFAULT_CATEGORY = ''
const TOAST_MS = 5000

const INPUT_SEARCH_CLASS =
  'min-h-11 flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3 text-base text-white placeholder:text-slate-600'

function rpcMessage(data) {
  if (!data || typeof data !== 'object') return 'ไม่ทราบสาเหตุ'
  return data.message || data.error || 'คำขอไม่สำเร็จ'
}

function isRpcOk(data) {
  return Boolean(data && typeof data === 'object' && data.ok === true)
}

function throwIfRpcFailed(result) {
  if (result.error) {
    throw new Error(result.error.message || String(result.error))
  }
  if (!isRpcOk(result.data)) {
    throw new Error(rpcMessage(result.data))
  }
}

function formatBaht(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return '—'
  return x.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function normalizeProductCategory(p) {
  return (p.category || '').trim() || 'ทั่วไป'
}

function buildCategories(products) {
  const keys = new Set()
  for (const p of products) keys.add(normalizeProductCategory(p))
  return [
    DEFAULT_CATEGORY,
    ...Array.from(keys).sort((a, b) => a.localeCompare(b, TH)),
  ]
}

function filterProducts(products, query, categoryKey) {
  const q = query.trim().toLowerCase()
  return products.filter((p) => {
    if (categoryKey && categoryKey !== DEFAULT_CATEGORY) {
      if (normalizeProductCategory(p) !== categoryKey) return false
    }
    if (!q) return true
    return (p.name || '').toLowerCase().includes(q)
  })
}

function cartLinesSorted(cart) {
  return Object.values(cart).sort((a, b) => a.name.localeCompare(b.name, TH))
}

function cartSum(cart) {
  let s = 0
  for (const l of Object.values(cart)) {
    s += Number(l.price || 0) * l.qty
  }
  return s
}

/**
 * สร้างบิลใหม่ หรือคืน order_id ของบิล pending ที่มีอยู่ (แขกสั่งต่อ)
 */
async function ensurePendingOrderId(tableCode) {
  const code = tableCode.trim()
  const res = await createOrder(code)
  if (!res.error && isRpcOk(res.data)) {
    return res.data.order_id
  }

  const body = res.data
  if (
    body &&
    typeof body === 'object' &&
    body.error === 'table_has_open_order' &&
    body.table_id
  ) {
    const { data: row, error: qErr } = await supabase
      .from('orders')
      .select('id')
      .eq('table_id', body.table_id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (qErr) throw new Error(qErr.message || 'โหลดบิลโต๊ะไม่ได้')
    if (row?.id) return row.id
    throw new Error(
      'โต๊ะนี้มีบิลที่ยืนยันแล้วหรือรอชำระ — แจ้งพนักงานก่อนสั่งเพิ่ม'
    )
  }

  throw new Error(res.error?.message || rpcMessage(body) || 'เปิดบิลไม่ได้')
}

function useToastTimer(toast, clear) {
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(clear, TOAST_MS)
    return () => clearTimeout(t)
  }, [toast, clear])
}

const CategoryChips = memo(function CategoryChips({ categories, activeKey, onSelect }) {
  return (
    <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {categories.map((cat) => {
        const active = activeKey === cat
        const label = cat === DEFAULT_CATEGORY ? 'ทั้งหมด' : cat
        return (
          <button
            key={cat || 'all'}
            type="button"
            onClick={() => onSelect(cat)}
            className={`shrink-0 rounded-full px-4 py-2.5 text-sm font-semibold ${
              active
                ? 'bg-emerald-500 text-slate-950'
                : 'border border-slate-600 bg-slate-900 text-slate-200'
            }`}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
})

const MenuProductRow = memo(function MenuProductRow({
  product,
  qty,
  busy,
  hasTable,
  onBump,
}) {
  const img = typeof product.image_url === 'string' ? product.image_url.trim() : ''
  return (
    <li className="flex gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
      {img ? (
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-slate-800">
          {/* รองรับ URL รูปจาก Storage/ภายนอก — ไม่ใช้ next/image เพื่อไม่บังคับ domain whitelist */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={img}
            alt={product.name || 'เมนู'}
            className="h-full w-full object-cover"
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-white">{product.name}</p>
        <p className="mt-1 text-lg font-bold text-emerald-400">
          ฿{formatBaht(product.price)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          aria-label="ลด"
          disabled={busy || !hasTable}
          onClick={() => onBump(product, -1)}
          className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-700 text-xl font-bold text-white disabled:opacity-30 active:bg-slate-600"
        >
          −
        </button>
        <span className="w-8 text-center text-lg font-bold tabular-nums">{qty}</span>
        <button
          type="button"
          aria-label="เพิ่ม"
          disabled={busy || !hasTable}
          onClick={() => onBump(product, 1)}
          className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-600 text-xl font-bold text-white disabled:opacity-30 active:bg-emerald-500"
        >
          +
        </button>
      </div>
    </li>
  )
})

const MenuProductList = memo(function MenuProductList({
  products,
  cartQtyById,
  busy,
  hasTable,
  onBump,
}) {
  return (
    <ul className="flex flex-col gap-3 pb-4">
      {products.map((p) => (
        <MenuProductRow
          key={p.id}
          product={p}
          qty={cartQtyById[p.id] ?? 0}
          busy={busy}
          hasTable={hasTable}
          onBump={onBump}
        />
      ))}
    </ul>
  )
})

export default function MenuPage() {
  return (
    <Suspense fallback={<MenuFallback />}>
      <GuestMenu />
    </Suspense>
  )
}

function MenuFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center bg-slate-950 px-4 text-slate-400">
      กำลังโหลดเมนู…
    </div>
  )
}

function GuestMenu() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlTable = (searchParams.get('table') || '').trim()

  const [manualTable, setManualTable] = useState('')
  const tableCode = urlTable || manualTable.trim()

  const [products, setProducts] = useState([])
  const [loadError, setLoadError] = useState(null)
  const [loadingMenu, setLoadingMenu] = useState(true)

  const [query, setQuery] = useState('')
  const [category, setCategory] = useState(DEFAULT_CATEGORY)

  /** @type {Record<string, { id: string, name: string, price: number, qty: number }>} */
  const [cart, setCart] = useState({})

  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)

  const clearToast = useCallback(() => setToast(null), [])
  useToastTimer(toast, clearToast)

  const loadMenu = useCallback(async () => {
    setLoadingMenu(true)
    setLoadError(null)
    try {
      const res = await fetch('/api/menu/products', { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) {
        const msg =
          (json.error && typeof json.error.message === 'string' && json.error.message) ||
          (typeof json.error === 'string' ? json.error : null) ||
          `HTTP ${res.status}`
        setLoadError(msg)
        setProducts([])
        return
      }
      setProducts(Array.isArray(json.products) ? json.products : [])
    } catch (e) {
      setLoadError(formatUnknownError(e))
      setProducts([])
    } finally {
      setLoadingMenu(false)
    }
  }, [])

  useEffect(() => {
    void loadMenu()
  }, [loadMenu])

  const categories = useMemo(() => buildCategories(products), [products])

  const filtered = useMemo(
    () => filterProducts(products, query, category),
    [products, query, category]
  )

  const lines = useMemo(() => cartLinesSorted(cart), [cart])
  const cartTotal = useMemo(() => cartSum(cart), [cart])

  const cartQtyById = useMemo(() => {
    const m = {}
    for (const id of Object.keys(cart)) {
      m[id] = cart[id].qty
    }
    return m
  }, [cart])

  const bump = useCallback((product, delta) => {
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

  const applyTableFromInput = useCallback(() => {
    let code = ''
    try {
      code = requireTableCode(manualTable)
    } catch (e) {
      setToast({ type: 'err', text: e.message || 'ใส่รหัสโต๊ะ เช่น A1' })
      return
    }
    router.replace(`/menu?table=${encodeURIComponent(code)}`)
  }, [manualTable, router])

  const handleSubmit = useCallback(async () => {
    if (!tableCode) {
      setToast({ type: 'err', text: 'ระบุโต๊ะจาก QR หรือใส่รหัสโต๊ะด้านบน' })
      return
    }
    if (lines.length === 0) {
      setToast({ type: 'err', text: 'เลือกเมนูอย่างน้อย 1 รายการ' })
      return
    }

    setBusy(true)
    setToast(null)
    try {
      const safeTableCode = requireTableCode(tableCode)
      const orderId = await ensurePendingOrderId(safeTableCode)

      for (const line of lines) {
        throwIfRpcFailed(await addItemToOrder(orderId, line.id, line.qty))
      }
      throwIfRpcFailed(await submitOrder(orderId))

      setCart({})
      setToast({
        type: 'ok',
        text: 'ส่งคำสั่งเข้าครัวแล้ว · ขอบคุณค่ะ',
      })
    } catch (e) {
      setToast({ type: 'err', text: e.message || 'ส่งคำสั่งไม่สำเร็จ' })
    } finally {
      setBusy(false)
    }
  }, [tableCode, lines])

  const hasTable = Boolean(tableCode)

  return (
    <div className="min-h-dvh bg-slate-950 pb-36 text-slate-100">
      <header className="sticky top-0 z-20 border-b border-slate-800/80 bg-slate-950/95 backdrop-blur-md">
        <div className="mx-auto max-w-lg px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-xl font-bold tracking-tight text-white">เมนู</h1>
            {hasTable ? (
              <Link
                href={`/status?table=${encodeURIComponent(tableCode)}`}
                className="shrink-0 rounded-full bg-slate-800 px-3 py-2 text-sm font-medium text-emerald-300 hover:bg-slate-700"
              >
                สถานะออเดอร์
              </Link>
            ) : (
              <span className="shrink-0 rounded-full px-3 py-2 text-sm font-medium text-slate-600">
                สถานะออเดอร์
              </span>
            )}
          </div>

          {hasTable ? (
            <p className="mt-2 text-sm text-slate-400">
              โต๊ะ <span className="font-semibold text-emerald-400">{tableCode}</span>
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              <p className="text-sm text-amber-200/90">สแกน QR ที่โต๊ะ หรือใส่รหัสโต๊ะ</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="text"
                  autoCapitalize="characters"
                  placeholder="เช่น A1"
                  value={manualTable}
                  onChange={(e) => setManualTable(e.target.value)}
                  className="min-h-12 flex-1 rounded-xl border border-slate-600 bg-slate-900 px-3 text-base text-white placeholder:text-slate-600"
                />
                <button
                  type="button"
                  onClick={applyTableFromInput}
                  className="min-h-12 shrink-0 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white active:bg-emerald-500"
                >
                  ตกลง
                </button>
              </div>
            </div>
          )}

          <div className="mt-3 flex gap-2">
            <input
              type="search"
              placeholder="ค้นหาเมนู…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={INPUT_SEARCH_CLASS}
            />
          </div>

          <CategoryChips categories={categories} activeKey={category} onSelect={setCategory} />
        </div>
      </header>

      <main className="mx-auto max-w-lg px-4 pt-4">
        {toast ? (
          <div
            role="status"
            className={`mb-4 rounded-xl px-4 py-3 text-sm font-medium ${
              toast.type === 'ok'
                ? 'bg-emerald-950/80 text-emerald-100'
                : 'bg-red-950/80 text-red-100'
            }`}
          >
            {toast.text}
          </div>
        ) : null}

        {loadingMenu && (
          <p className="py-8 text-center text-slate-500">กำลังโหลดเมนู…</p>
        )}
        {loadError && (
          <div className="rounded-xl border border-red-900 bg-red-950/40 p-4 text-red-100">
            <p className="font-medium">โหลดเมนูไม่ได้</p>
            <p className="mt-1 text-sm opacity-90">{loadError}</p>
            <button
              type="button"
              onClick={() => void loadMenu()}
              className="mt-3 min-h-11 rounded-lg bg-red-900 px-4 text-sm font-semibold"
            >
              ลองใหม่
            </button>
          </div>
        )}

        {!loadingMenu && !loadError && filtered.length === 0 && (
          <p className="py-8 text-center text-slate-500">ไม่พบเมนูตามตัวกรอง</p>
        )}

        {!loadingMenu && !loadError && filtered.length > 0 && (
          <MenuProductList
            products={filtered}
            cartQtyById={cartQtyById}
            busy={busy}
            hasTable={hasTable}
            onBump={bump}
          />
        )}
      </main>

      <footer className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-800 bg-slate-950/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md">
        <div className="mx-auto flex max-w-lg items-end justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-slate-500">
              {lines.length} รายการ · โต๊ะ {hasTable ? tableCode : '—'}
            </p>
            <p className="truncate text-2xl font-bold tabular-nums text-emerald-400">
              ฿{formatBaht(cartTotal)}
            </p>
          </div>
          <button
            type="button"
            disabled={busy || lines.length === 0 || !hasTable}
            onClick={() => void handleSubmit()}
            className="min-h-14 min-w-[10rem] shrink-0 rounded-2xl bg-emerald-500 px-5 text-base font-bold text-slate-950 shadow-lg shadow-emerald-900/30 disabled:opacity-35 active:bg-emerald-400"
          >
            {busy ? 'กำลังส่ง…' : 'ส่งคำสั่ง'}
          </button>
        </div>
      </footer>
    </div>
  )
}
