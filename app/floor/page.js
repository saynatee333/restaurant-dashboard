'use client'

import Link from 'next/link'
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useRouter } from 'next/navigation'
import { RoleGate } from '@/components/RoleGate'
import { useBranchContext } from '@/context/BranchContext'
import { scopeBranchOrLegacyNull } from '@/lib/supabaseBranchScope'
import { mergeTables, splitMergedTables, supabase } from '@/lib/supabase'

/** สถานะโต๊ะจาก enum `table_status` */
const STATUS_I18N = {
  available: { label: 'ว่าง', tone: 'border-emerald-500/40 bg-emerald-950/35 text-emerald-200' },
  occupied: { label: 'มีลูกค้า', tone: 'border-amber-500/40 bg-amber-950/35 text-amber-100' },
  reserved: { label: 'จองแล้ว', tone: 'border-sky-500/40 bg-sky-950/35 text-sky-100' },
  dirty: { label: 'รอทำความสะอาด', tone: 'border-slate-500/40 bg-slate-800/80 text-slate-200' },
}

const STATUS_KEYS = Object.freeze(Object.keys(STATUS_I18N))
const OPEN_ORDER_STATUSES = ['pending', 'confirmed']

const TABLES_SELECT =
  'id, code, zone, seat_capacity, status, merged_into, table_number'
const ORDERS_OPEN_SELECT = 'id, table_id, status, total_amount'

const SELECT_FIELD_CLASS =
  'min-h-12 rounded-xl border border-slate-600 bg-slate-950 px-3 text-base text-white focus-visible:outline focus-visible:ring-2 focus-visible:ring-emerald-500'

const REALTIME_DEBOUNCE_MS = 150
const BANNER_MS = 4500

function rpcErr(data, error) {
  if (error) return error.message || String(error)
  if (!data || typeof data !== 'object' || data.ok !== true) {
    return data?.message || data?.error || 'คำขอไม่สำเร็จ'
  }
  return null
}

function formatBaht(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return '—'
  return x.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/** โต๊ะที่ยังไม่ถูกผูกเป็นโต๊ะย่อย — ใช้เป็นได้ทั้งหลักและรองใน dropdown */
function standaloneTables(tables) {
  return tables.filter((t) => !t.merged_into)
}

/** จำนวนโต๊ะย่อยต่อโต๊ะหลัก (merged_into → primary id) */
function countMergedChildrenByPrimary(tables) {
  const counts = new Map()
  for (const t of tables) {
    if (!t.merged_into) continue
    const id = t.merged_into
    counts.set(id, (counts.get(id) || 0) + 1)
  }
  return counts
}

/** ต่อโต๊ะหลัก candidate: รายการโต๊ะรองที่เลือกได้ (ไม่รวมตัวเอง) */
function mergeOptionsByPrimaryId(tables) {
  const roots = standaloneTables(tables)
  const map = new Map()
  for (const p of roots) {
    map.set(
      p.id,
      roots.filter((x) => x.id !== p.id)
    )
  }
  return map
}

function indexFirstOpenOrderByTable(orders) {
  const m = new Map()
  for (const o of orders) {
    if (!o.table_id || m.has(o.table_id)) continue
    m.set(o.table_id, o)
  }
  return m
}

function useDebouncedFloorRealtime(refresh, debounceMs) {
  const timerRef = useRef(null)

  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void refresh()
    }, debounceMs)
  }, [refresh, debounceMs])

  useEffect(() => {
    const channel = supabase
      .channel('floor-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tables' },
        schedule
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        schedule
      )
      .subscribe()

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      supabase.removeChannel(channel)
    }
  }, [schedule])
}

function useBannerTimer(banner, clearBanner) {
  useEffect(() => {
    if (!banner) return
    const t = setTimeout(clearBanner, BANNER_MS)
    return () => clearTimeout(t)
  }, [banner, clearBanner])
}

const TableCard = memo(function TableCard({
  table,
  statusVisual,
  primaryOf,
  openOrder,
  isSatellite,
  mergedChildCount,
  mergePartnerOptions,
  mergePartnerValue,
  onMergePartnerChange,
  onMerge,
  onSplit,
  onStatusChange,
  onOpenPos,
}) {
  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => onOpenPos(table)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpenPos(table)
        }
      }}
      className={`cursor-pointer rounded-2xl border p-4 outline-none transition hover:border-slate-500 focus-visible:ring-2 focus-visible:ring-emerald-500 ${statusVisual.tone}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-2xl font-bold text-white">{table.code}</h2>
          <p className="text-sm text-slate-400">
            โซน {table.zone} · {table.seat_capacity} ที่นั่ง · #{table.table_number}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide">
          {statusVisual.label}
        </span>
      </div>

      {isSatellite && primaryOf ? (
        <p className="mt-3 text-sm text-sky-200">
          🔗 รวมเข้าโต๊ะหลัก <strong>{primaryOf.code}</strong> · แตะการ์ดเพื่อไปเปิดบิลที่โต๊ะหลัก
        </p>
      ) : null}

      {openOrder ? (
        <p className="mt-2 text-sm text-slate-200">
          บิลค้าง ·{' '}
          <span className="font-mono text-xs">{String(openOrder.id).slice(0, 8)}…</span> ·{' '}
          {openOrder.status} · ฿{formatBaht(openOrder.total_amount)}
        </p>
      ) : (
        <p className="mt-2 text-sm text-slate-500">ไม่มีบิลค้าง (pending/confirmed)</p>
      )}

      <div
        className="mt-4 flex flex-col gap-3 border-t border-white/10 pt-4"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-300">
          เปลี่ยนสถานะโต๊ะ
          <select
            value={table.status}
            onChange={(e) => onStatusChange(table, e.target.value)}
            className={SELECT_FIELD_CLASS}
          >
            {STATUS_KEYS.map((key) => (
              <option key={key} value={key}>
                {STATUS_I18N[key].label} ({key})
              </option>
            ))}
          </select>
        </label>

        {!isSatellite ? (
          <>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
              <select
                aria-label="เลือกโต๊ะรองเพื่อรวมบิล"
                value={mergePartnerValue}
                onChange={(e) => onMergePartnerChange(table.id, e.target.value)}
                className={`${SELECT_FIELD_CLASS} flex-1`}
              >
                <option value="">รวมบิลจากโต๊ะ…</option>
                {mergePartnerOptions.map((x) => (
                  <option key={x.id} value={x.code}>
                    {x.code} ({x.zone})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => onMerge(table)}
                className="min-h-12 shrink-0 rounded-xl bg-violet-600 px-4 text-base font-bold text-white hover:bg-violet-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300"
              >
                รวมโต๊ะ
              </button>
            </div>

            <button
              type="button"
              onClick={() => onSplit(table)}
              className="min-h-12 w-full rounded-xl border border-slate-500 bg-slate-800 text-base font-semibold text-slate-100 hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
            >
              แยกโต๊ะย่อย{mergedChildCount > 0 ? ` (${mergedChildCount})` : ''}
            </button>
          </>
        ) : (
          <p className="text-xs text-slate-500">
            โต๊ะนี้เป็นโต๊ะย่อยหลังรวม — ใช้โต๊ะหลักเพื่อ «แยกโต๊ะย่อย»
          </p>
        )}

        <button
          type="button"
          onClick={() => onOpenPos(table)}
          className="min-h-14 w-full rounded-xl bg-emerald-600 text-lg font-bold text-white hover:bg-emerald-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
        >
          เปิด POS / สั่งอาหาร
        </button>
      </div>
    </article>
  )
})

function FloorPageInner() {
  const router = useRouter()
  const { effectiveBranchId } = useBranchContext()
  const [tables, setTables] = useState([])
  const [openOrders, setOpenOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [banner, setBanner] = useState(null)
  const [mergePartnerCode, setMergePartnerCode] = useState({})

  const clearBanner = useCallback(() => setBanner(null), [])
  useBannerTimer(banner, clearBanner)

  const refresh = useCallback(async () => {
    let tQ = supabase
      .from('tables')
      .select(TABLES_SELECT)
      .order('zone', { ascending: true })
      .order('table_number', { ascending: true })
    let oQ = supabase
      .from('orders')
      .select(ORDERS_OPEN_SELECT)
      .in('status', OPEN_ORDER_STATUSES)
      .order('created_at', { ascending: false })

    if (effectiveBranchId) {
      tQ = scopeBranchOrLegacyNull(tQ, effectiveBranchId, 'branch_id')
      oQ = scopeBranchOrLegacyNull(oQ, effectiveBranchId, 'branch_id')
    }

    const [tRes, oRes] = await Promise.all([tQ, oQ])

    if (!tRes.error) setTables(tRes.data || [])
    else setTables([])

    if (!oRes.error) setOpenOrders(oRes.data || [])
    else setOpenOrders([])

    setLoading(false)
  }, [effectiveBranchId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useDebouncedFloorRealtime(refresh, REALTIME_DEBOUNCE_MS)

  const idToTable = useMemo(() => {
    const m = new Map()
    for (const t of tables) m.set(t.id, t)
    return m
  }, [tables])

  const ordersByTableId = useMemo(
    () => indexFirstOpenOrderByTable(openOrders),
    [openOrders]
  )

  const mergedChildCounts = useMemo(
    () => countMergedChildrenByPrimary(tables),
    [tables]
  )

  const mergeOptionsByPrimary = useMemo(
    () => mergeOptionsByPrimaryId(tables),
    [tables]
  )

  const goPos = useCallback(
    (tableCode) => {
      router.push(`/pos?table=${encodeURIComponent(tableCode)}`)
    },
    [router]
  )

  const onOpenPos = useCallback(
    (table) => {
      if (table.merged_into) {
        const primary = idToTable.get(table.merged_into)
        goPos(primary?.code || table.code)
        return
      }
      goPos(table.code)
    },
    [goPos, idToTable]
  )

  const onMergePartnerChange = useCallback((tableId, code) => {
    setMergePartnerCode((prev) => ({ ...prev, [tableId]: code }))
  }, [])

  const onStatusChange = useCallback(
    async (table, nextStatus) => {
      const { error } = await supabase
        .from('tables')
        .update({ status: nextStatus })
        .eq('id', table.id)
      if (error) setBanner({ type: 'err', text: error.message })
      else await refresh()
    },
    [refresh]
  )

  const onMerge = useCallback(
    async (primaryTable) => {
      const secondaryCode = mergePartnerCode[primaryTable.id]?.trim()
      if (!secondaryCode) {
        setBanner({ type: 'err', text: 'เลือกโต๊ะรอง (โต๊ะที่จะดึงบิลมารวม)' })
        return
      }
      if (secondaryCode === primaryTable.code) {
        setBanner({ type: 'err', text: 'โต๊ะหลักและโต๊ะรองต้องเป็นคนละโต๊ะ' })
        return
      }

      const { data, error } = await mergeTables(primaryTable.code, secondaryCode)
      const msg = rpcErr(data, error)
      if (msg) {
        setBanner({ type: 'err', text: msg })
        return
      }
      setBanner({
        type: 'ok',
        text: `รวมโต๊ะแล้ว · บิลจาก ${secondaryCode} → ${primaryTable.code}`,
      })
      setMergePartnerCode((prev) => ({ ...prev, [primaryTable.id]: '' }))
      await refresh()
    },
    [mergePartnerCode, refresh]
  )

  const onSplit = useCallback(
    async (primaryTable) => {
      const { data, error } = await splitMergedTables(primaryTable.code)
      const msg = rpcErr(data, error)
      if (msg) {
        setBanner({ type: 'err', text: msg })
        return
      }
      const n = data.tables_unmerged ?? 0
      setBanner({
        type: 'ok',
        text:
          n > 0
            ? `แยกโต๊ะแล้ว · คืนสถานะโต๊ะย่อย ${n} โต๊ะ`
            : 'แยกโต๊ะสำเร็จ (ไม่มีโต๊ะย่อยที่ผูกอยู่)',
      })
      await refresh()
    },
    [refresh]
  )

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100 md:px-8">
      <header className="mx-auto mb-8 flex max-w-6xl flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link
            href="/dashboard"
            className="inline-flex min-h-11 items-center rounded-xl border border-slate-600 px-4 text-sm font-medium text-slate-300 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
          >
            ← กลับ Dashboard
          </Link>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-white">ผังโต๊ะ</h1>
          <p className="mt-2 max-w-xl text-slate-400">
            แสดงโต๊ะทั้งหมดและสถานะแบบเรียลไทม์ · แตะการ์ดเพื่อเปิด POS · รวม/แยกโต๊ะตาม RPC ของระบบ
          </p>
        </div>
        <p className="text-xs text-slate-500">
          Realtime: อัปเดตเมื่อตาราง <code className="rounded bg-slate-800 px-1">tables</code> หรือ{' '}
          <code className="rounded bg-slate-800 px-1">orders</code> เปลี่ยน (ต้องเปิด Replication ใน Supabase)
        </p>
      </header>

      {banner ? (
        <div
          role="status"
          className={`mx-auto mb-6 max-w-6xl rounded-xl px-4 py-3 text-sm font-medium ${
            banner.type === 'ok'
              ? 'border border-emerald-800 bg-emerald-950/50 text-emerald-100'
              : 'border border-red-800 bg-red-950/50 text-red-100'
          }`}
        >
          {banner.text}
        </div>
      ) : null}

      {loading ? (
        <p className="mx-auto max-w-6xl text-lg text-slate-500">กำลังโหลดผังโต๊ะ…</p>
      ) : tables.length === 0 ? (
        <p className="mx-auto max-w-6xl text-slate-400">ยังไม่มีข้อมูลโต๊ะในระบบ</p>
      ) : (
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tables.map((table) => {
            const statusVisual = STATUS_I18N[table.status] || STATUS_I18N.available
            const primaryOf = table.merged_into ? idToTable.get(table.merged_into) : null
            const isSatellite = Boolean(table.merged_into)

            return (
              <TableCard
                key={table.id}
                table={table}
                statusVisual={statusVisual}
                primaryOf={primaryOf}
                openOrder={ordersByTableId.get(table.id)}
                isSatellite={isSatellite}
                mergedChildCount={mergedChildCounts.get(table.id) || 0}
                mergePartnerOptions={mergeOptionsByPrimary.get(table.id) || []}
                mergePartnerValue={mergePartnerCode[table.id] || ''}
                onMergePartnerChange={onMergePartnerChange}
                onMerge={onMerge}
                onSplit={onSplit}
                onStatusChange={onStatusChange}
                onOpenPos={onOpenPos}
              />
            )
          })}
        </div>
      )}
    </main>
  )
}

export default function FloorPage() {
  return (
    <RoleGate>
      <FloorPageInner />
    </RoleGate>
  )
}
