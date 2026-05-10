'use client'

import Link from 'next/link'
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useRouter } from 'next/navigation'
import {
  ORDERS_REALTIME_CHANNEL,
  ORDERS_REALTIME_DEBOUNCE_MS,
  useSupabaseOrdersRealtime,
} from '@/hooks/useSupabaseOrdersRealtime'
import { formatBaht } from '@/lib/formatBaht'
import { formatUnknownError } from '@/lib/formatUnknownError'
import { isRpcOk, rpcMessage } from '@/lib/supabaseRpc'
import { BranchScopeSelector } from '@/components/BranchScopeSelector'
import { RoleGate } from '@/components/RoleGate'
import { useBranchContext } from '@/context/BranchContext'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import {
  loadDashboardSummaryCache,
  saveDashboardSummaryCache,
} from '@/lib/offline/dashboardCache'
import { fetchDailySummary, supabase } from '@/lib/supabase'

const PANEL =
  'rounded-2xl border border-slate-800 bg-slate-900/50 p-6'
const DASHBOARD_SUMMARY_TTL_MS = 10_000
const dashboardSummaryMemoryCache = new Map()

function todayIsoLocal() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function donutGradient(dineInOrders, takeawayOrders) {
  const di = Number(dineInOrders || 0)
  const tw = Number(takeawayOrders || 0)
  const t = di + tw
  if (t <= 0) {
    return 'conic-gradient(rgb(51 65 85) 0deg 360deg)'
  }
  const pct = (di / t) * 360
  return `conic-gradient(rgb(16 185 129) 0deg ${pct}deg, rgb(139 92 246) ${pct}deg 360deg)`
}

function normalizeTopProducts(summary) {
  const rows = summary?.top_products
  return Array.isArray(rows) ? rows : []
}

function computeMaxQty(rows) {
  let m = 0
  for (const p of rows) {
    const q = Number(p.qty_sold || 0)
    if (q > m) m = q
  }
  return m || 1
}

/** @param {Record<string, unknown> | null} summary */
function deriveMetrics(summary) {
  if (!summary) return null
  const dineInOrders = Number(summary.dine_in_orders ?? 0)
  const takeawayOrders = Number(summary.takeaway_orders ?? 0)
  const gross = Number(summary.gross_sales ?? 0)
  return {
    gross,
    totalOrders: Number(summary.total_orders ?? 0),
    paidOrders: Number(summary.paid_orders ?? 0),
    cancelledOrders: Number(summary.cancelled_orders ?? 0),
    dineInSales: Number(summary.dine_in_sales ?? 0),
    takeawaySales: Number(summary.takeaway_sales ?? 0),
    dineInOrders,
    takeawayOrders,
    donutBackground: donutGradient(dineInOrders, takeawayOrders),
  }
}

const StatCard = memo(function StatCard({ title, value, hint }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-sm">
      <p className="text-sm font-medium text-slate-400">{title}</p>
      <p className="mt-2 text-2xl font-bold tabular-nums text-white">{value}</p>
      {hint ? (
        <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-slate-600">{hint}</p>
      ) : null}
    </div>
  )
})

const SalesBar = memo(function SalesBar({ label, amount, total, tone }) {
  const pct = Math.min(100, Math.round((amount / total) * 100))
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span className="text-slate-300">{label}</span>
        <span className="tabular-nums text-slate-400">฿{formatBaht(amount)}</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
})

const NavChip = memo(function NavChip({ href, label }) {
  return (
    <Link
      href={href}
      className="rounded-full border border-slate-600 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800"
    >
      {label}
    </Link>
  )
})

const OrderMixDonut = memo(function OrderMixDonut({ background }) {
  return (
    <div
      className="h-44 w-44 shrink-0 rounded-full border-4 border-slate-800 shadow-inner"
      style={{ background }}
      role="img"
      aria-label="สัดส่วนออเดอร์ dine-in และ takeaway"
    />
  )
})

const TopProductRow = memo(function TopProductRow({ product, maxQty }) {
  const qty = Number(product.qty_sold || 0)
  const widthPct = Math.max(8, (qty / maxQty) * 100)
  return (
    <li className="space-y-1">
      <div className="flex justify-between gap-2 text-sm">
        <span className="truncate font-medium text-slate-100">{product.name}</span>
        <span className="shrink-0 tabular-nums text-slate-400">
          {product.qty_sold} ชิ้น · ฿{formatBaht(product.revenue)}
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full rounded-full bg-cyan-500 transition-[width] duration-300"
          style={{ width: `${widthPct}%` }}
        />
      </div>
    </li>
  )
})

const TopProductsSection = memo(function TopProductsSection({ products, maxQty }) {
  return (
    <section className={`mt-8 ${PANEL}`}>
      <h2 className="text-lg font-semibold text-white">สินค้าขายดี (paid)</h2>
      <p className="mt-1 text-xs text-slate-500">เรียงจากจำนวนชิ้นที่ขายได้ในวันนั้น</p>
      {products.length === 0 ? (
        <p className="mt-6 text-slate-500">ยังไม่มีข้อมูลสินค้าในวันนี้</p>
      ) : (
        <ul className="mt-6 space-y-4">
          {products.map((p, i) => (
            <TopProductRow key={p.product_id ?? i} product={p} maxQty={maxQty} />
          ))}
        </ul>
      )}
    </section>
  )
})

const StatGrid = memo(function StatGrid({ metrics }) {
  if (!metrics) return null
  return (
    <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard title="ยอดขายวันนี้ (paid)" value={`฿${formatBaht(metrics.gross)}`} hint="gross_sales" />
      <StatCard title="จำนวนออเดอร์ทั้งหมด" value={String(metrics.totalOrders)} hint="total_orders" />
      <StatCard title="ออเดอร์ที่ชำระแล้ว" value={String(metrics.paidOrders)} hint="paid_orders" />
      <StatCard title="ยกเลิก" value={String(metrics.cancelledOrders)} hint="cancelled_orders" />
    </section>
  )
})

const ChannelCharts = memo(function ChannelCharts({ metrics }) {
  if (!metrics) return null
  const totalSales = metrics.gross || 1
  return (
    <section className="mt-8 grid gap-6 lg:grid-cols-2">
      <div className={PANEL}>
        <h2 className="text-lg font-semibold text-white">ทานที่ร้าน vs ห่อกลับ</h2>
        <p className="mt-1 text-xs text-slate-500">
          นับเฉพาะบิล <strong className="text-slate-400">paid</strong> · มีโต๊ะ = dine-in · ไม่มีโต๊ะ =
          takeaway
        </p>
        <div className="mt-6 flex flex-col items-center gap-6 sm:flex-row sm:justify-around">
          <OrderMixDonut background={metrics.donutBackground} />
          <div className="w-full max-w-xs space-y-3 text-sm">
            <div className="flex justify-between gap-4 rounded-lg bg-emerald-950/40 px-4 py-3">
              <span className="text-emerald-200">ทานที่ร้าน</span>
              <span className="font-mono text-emerald-100">
                {metrics.dineInOrders} บิล · ฿{formatBaht(metrics.dineInSales)}
              </span>
            </div>
            <div className="flex justify-between gap-4 rounded-lg bg-violet-950/40 px-4 py-3">
              <span className="text-violet-200">ห่อกลับ</span>
              <span className="font-mono text-violet-100">
                {metrics.takeawayOrders} บิล · ฿{formatBaht(metrics.takeawaySales)}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className={PANEL}>
        <h2 className="text-lg font-semibold text-white">ยอดขายแยกช่องทาง</h2>
        <p className="mt-1 text-xs text-slate-500">จากบิล paid เท่านั้น</p>
        <div className="mt-6 space-y-4">
          <SalesBar label="ทานที่ร้าน" amount={metrics.dineInSales} total={totalSales} tone="bg-emerald-500" />
          <SalesBar label="ห่อกลับ" amount={metrics.takeawaySales} total={totalSales} tone="bg-violet-500" />
        </div>
      </div>
    </section>
  )
})

const DashboardNav = memo(function DashboardNav() {
  const { profile } = useBranchContext()
  const links = useMemo(() => {
    const all = [
      { href: '/pos', label: 'POS' },
      { href: '/floor', label: 'ผังโต๊ะ' },
      { href: '/kitchen', label: 'ครัว' },
      { href: '/menu', label: 'เมนูแขก' },
      { href: '/admin', label: 'แอดมิน' },
    ]
    if (profile?.role !== 'admin') return all.filter((x) => x.href !== '/admin')
    return all
  }, [profile?.role])
  return (
    <nav className="mt-12 flex flex-wrap gap-3 border-t border-slate-800 pt-8">
      {links.map(({ href, label }) => (
        <NavChip key={href} href={href} label={label} />
      ))}
    </nav>
  )
})

export default function DashboardPage() {
  const router = useRouter()
  const online = useOnlineStatus()
  const [day, setDay] = useState(todayIsoLocal)
  const [summary, setSummary] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [logoutBusy, setLogoutBusy] = useState(false)

  const loadSummary = useCallback(async (options = {}) => {
    const { force = false } = options
    setLoadError(null)

    let allowNetwork = online
    if (!allowNetwork) {
      try {
        const ping = await fetch('/api/v1/ping', { cache: 'no-store' })
        if (ping.ok) allowNetwork = true
      } catch {
        /* เครือข่ายจริงล่ม */
      }
    }

    if (!allowNetwork) {
      const cached = loadDashboardSummaryCache(day)
      if (cached && isRpcOk(cached)) {
        setSummary(cached)
        setLoading(false)
        return
      }
      setSummary(null)
      setLoadError('ออฟไลน์ — ไม่มีข้อมูลสรุปที่แคชไว้สำหรับวันนี้')
      setLoading(false)
      return
    }

    const cacheKey = `day:${day}`
    if (!force) {
      const mem = dashboardSummaryMemoryCache.get(cacheKey)
      if (
        mem &&
        Date.now() - mem.ts <= DASHBOARD_SUMMARY_TTL_MS &&
        isRpcOk(mem.data)
      ) {
        setSummary(mem.data)
        setLoading(false)
        return
      }
    }

    setLoading(true)
    const { data, error } = await fetchDailySummary(day)
    if (error) {
      setLoadError(formatUnknownError(error))
      setSummary(null)
      setLoading(false)
      return
    }
    if (!isRpcOk(data)) {
      setLoadError(rpcMessage(data))
      setSummary(null)
      setLoading(false)
      return
    }
    setSummary(data)
    dashboardSummaryMemoryCache.set(cacheKey, { ts: Date.now(), data })
    saveDashboardSummaryCache(day, data)
    setLoading(false)
  }, [day, online])

  useEffect(() => {
    void loadSummary()
  }, [loadSummary])

  useSupabaseOrdersRealtime(loadSummary, {
    debounceMs: ORDERS_REALTIME_DEBOUNCE_MS.dashboard,
    channelName: ORDERS_REALTIME_CHANNEL.dashboard,
  })

  const metrics = useMemo(() => deriveMetrics(summary), [summary])
  const topProducts = useMemo(() => normalizeTopProducts(summary), [summary])
  const maxQty = useMemo(() => computeMaxQty(topProducts), [topProducts])

  const handleLogout = useCallback(async () => {
    setLogoutBusy(true)
    const { error } = await supabase.auth.signOut()
    setLogoutBusy(false)
    if (error) {
      alert(error.message)
      return
    }
    router.push('/login')
  }, [router])

  const onRefresh = useCallback(() => void loadSummary({ force: true }), [loadSummary])

  return (
    <RoleGate>
      <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100 md:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col gap-4 border-b border-slate-800 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">แดชบอร์ด</h1>
            <p className="mt-1 text-sm text-slate-400">
              ข้อมูลจาก <code className="rounded bg-slate-800 px-1">pos_daily_summary</code> ·
              ช่วงวันตาม UTC ของฐานข้อมูล (ดู timezone_note จาก RPC)
              {!online ? (
                <span className="ml-2 text-amber-400">· โหมดออฟไลน์ (แคช)</span>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <BranchScopeSelector />
            <label className="flex items-center gap-2 text-sm text-slate-400">
              วันที่
              <input
                type="date"
                value={day}
                onChange={(e) => setDay(e.target.value)}
                className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white"
              />
            </label>
            <button
              type="button"
              disabled={loading}
              onClick={onRefresh}
              className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-40"
            >
              รีเฟรช
            </button>
            <button
              type="button"
              disabled={logoutBusy}
              onClick={() => void handleLogout()}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-40"
            >
              {logoutBusy ? 'กำลังออก…' : 'ออกจากระบบ'}
            </button>
          </div>
        </header>

        {loadError ? (
          <div className="mt-6 rounded-xl border border-red-900 bg-red-950/40 p-4 text-red-100">
            <p className="font-medium">โหลดสรุปไม่ได้</p>
            <p className="mt-1 text-sm">{loadError}</p>
            <button
              type="button"
              onClick={onRefresh}
              className="mt-3 rounded-lg border border-red-700 px-3 py-1.5 text-sm hover:bg-red-900/40"
            >
              ลองโหลดอีกครั้ง
            </button>
          </div>
        ) : null}

        {loading && !summary ? (
          <p className="mt-10 text-slate-500">กำลังโหลด…</p>
        ) : null}

        {summary && metrics ? (
          <>
            <StatGrid metrics={metrics} />
            <ChannelCharts metrics={metrics} />
            <TopProductsSection products={topProducts} maxQty={maxQty} />
          </>
        ) : null}

        <DashboardNav />
      </div>
      </main>
    </RoleGate>
  )
}
