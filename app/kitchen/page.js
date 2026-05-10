'use client'

/**
 * Kitchen Display — ออเดอร์เข้าแบบเรียลไทม์ จัดคอลัมน์ตาม order_items.status (pending | firing)
 */

import { RoleGate } from '@/components/RoleGate'
import { useBranchContext } from '@/context/BranchContext'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import {
  ORDERS_REALTIME_CHANNEL,
  ORDERS_REALTIME_DEBOUNCE_MS,
  useSupabaseOrdersRealtime,
} from '@/hooks/useSupabaseOrdersRealtime'
import { useKitchenNewOrderNotification } from '@/hooks/useKitchenNewOrderNotification'
import {
  fetchKitchenQueueRows,
  groupKitchenQueueByStatus,
  menuRefFromKitchenRow,
} from '@/lib/kitchenQueue'
import { kitchenMarkItemDone, kitchenMarkItemPreparing } from '@/lib/kitchenOrderActions'

const STATUS_COLUMNS = [
  {
    dbStatus: 'pending',
    title: 'รอรับออเดอร์',
    subtitle: 'ออเดอร์ใหม่ — กดเมื่อเริ่มปรุง',
  },
  {
    dbStatus: 'firing',
    title: 'กำลังเตรียม',
    subtitle: 'กำลังปรุง — เทียบเท่า preparing',
  },
]

const KitchenTicketCard = memo(function KitchenTicketCard({
  row,
  onMarkPreparing,
  onMarkDone,
}) {
  const menuRef = menuRefFromKitchenRow(row)
  const modifiers = Array.isArray(row.selected_modifiers) ? row.selected_modifiers : []
  const orderId = row.orders?.id
  const station = menuRef?.station || 'kitchen'
  const isPending = row.status === 'pending'

  return (
    <article style={sx.card}>
      <div style={sx.cardTitleRow}>
        <strong>{menuRef?.name || 'Unknown item'}</strong>
        <span style={sx.qtyBadge}>×{row.qty}</span>
      </div>
      <div style={sx.metaRow}>
        <small style={{ color: '#94a3b8' }}>
          บิล #{orderId} · โต๊ะ {row.orders?.table_id ?? '-'}
        </small>
        <span style={sx.stationPill}>{station}</span>
      </div>
      {modifiers.length > 0 ? (
        <ul style={sx.modifierList}>
          {modifiers.map((m, idx) => (
            <li key={`${String(m.label ?? m.name ?? '')}-${idx}`}>{m.label || m.name}</li>
          ))}
        </ul>
      ) : null}
      {row.note ? <p style={sx.note}>หมายเหตุ: {row.note}</p> : null}

      <div style={sx.actions}>
        {isPending ? (
          <button
            type="button"
            style={sx.prepareButton}
            onClick={() => void onMarkPreparing(row.id, orderId)}
          >
            กำลังเตรียม
          </button>
        ) : (
          <button type="button" style={sx.doneButton} onClick={() => void onMarkDone(row.id)}>
            เสร็จแล้ว
          </button>
        )}
      </div>
    </article>
  )
})

const KitchenStatusColumn = memo(function KitchenStatusColumn({
  column,
  rows,
  onMarkPreparing,
  onMarkDone,
}) {
  return (
    <section style={sx.column}>
      <div style={sx.columnHead}>
        <h2 style={sx.columnTitle}>{column.title}</h2>
        <span style={sx.countBadge}>{rows.length}</span>
      </div>
      <p style={sx.columnSubtitle}>{column.subtitle}</p>
      {rows.length === 0 ? (
        <p style={sx.empty}>ไม่มีรายการ</p>
      ) : (
        rows.map((row) => (
          <KitchenTicketCard
            key={row.id}
            row={row}
            onMarkPreparing={onMarkPreparing}
            onMarkDone={onMarkDone}
          />
        ))
      )}
    </section>
  )
})

function KitchenIntro() {
  return (
    <header style={{ marginBottom: 20 }}>
      <h1 style={{ marginTop: 0, marginBottom: 8 }}>จอครัว (Kitchen)</h1>
      <p style={{ color: '#94a3b8', maxWidth: 640, lineHeight: 1.5 }}>
        แสดงรายการจากบิลที่ยังปรุงไม่เสร็จ · จัดกลุ่มตามสถานะ{' '}
        <strong style={{ color: '#e2e8f0' }}>รอรับ</strong> /{' '}
        <strong style={{ color: '#e2e8f0' }}>กำลังเตรียม</strong> · กดปุ่มเปลี่ยนสถานะ · อัปเดตแบบเรียลไทม์จากตาราง{' '}
        <code style={{ color: '#cbd5e1' }}>orders</code> และ{' '}
        <code style={{ color: '#cbd5e1' }}>order_items</code>
      </p>
    </header>
  )
}

function KitchenScreen() {
  const { effectiveBranchId } = useBranchContext()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [actionError, setActionError] = useState(null)

  const fetchQueue = useCallback(async () => {
    setLoadError(null)
    const { data, error } = await fetchKitchenQueueRows(effectiveBranchId)
    if (error) {
      setLoadError(error.message || 'โหลดคิวครัวไม่สำเร็จ')
      setItems([])
    } else {
      setItems(data ?? [])
    }
    setLoading(false)
  }, [effectiveBranchId])

  useEffect(() => {
    void fetchQueue()
  }, [fetchQueue])

  useSupabaseOrdersRealtime(fetchQueue, {
    debounceMs: ORDERS_REALTIME_DEBOUNCE_MS.kitchen,
    channelName: ORDERS_REALTIME_CHANNEL.kitchen,
  })

  const byStatus = useMemo(() => groupKitchenQueueByStatus(items), [items])
  useKitchenNewOrderNotification(byStatus.pending || [])

  const markPreparing = useCallback(async (itemId, orderId) => {
    setActionError(null)
    try {
      await kitchenMarkItemPreparing(itemId, orderId)
    } catch (e) {
      setActionError(e.message || 'เปลี่ยนสถานะเป็นกำลังเตรียมไม่สำเร็จ')
    }
  }, [])

  const markDone = useCallback(async (itemId) => {
    setActionError(null)
    try {
      await kitchenMarkItemDone(itemId)
    } catch (e) {
      setActionError(e.message || 'เปลี่ยนสถานะเป็นเสร็จแล้วไม่สำเร็จ')
    }
  }, [])

  return (
    <main style={sx.page}>
      <KitchenIntro />
      {actionError ? (
        <p style={sx.errorBox}>{actionError}</p>
      ) : null}
      {loadError ? (
        <div style={sx.errorBox}>
          <p>{loadError}</p>
          <button type="button" style={sx.retryButton} onClick={() => void fetchQueue()}>
            ลองโหลดอีกครั้ง
          </button>
        </div>
      ) : null}

      {loading ? (
        <p style={{ color: '#64748b' }}>กำลังโหลดคิว...</p>
      ) : (
        <div style={sx.kanbanGrid}>
          {STATUS_COLUMNS.map((col) => (
            <KitchenStatusColumn
              key={col.dbStatus}
              column={col}
              rows={byStatus[col.dbStatus] ?? []}
              onMarkPreparing={markPreparing}
              onMarkDone={markDone}
            />
          ))}
        </div>
      )}
    </main>
  )
}

const sx = {
  page: {
    minHeight: '100vh',
    padding: 24,
    color: 'white',
    background: '#020617',
    fontFamily: 'system-ui, Segoe UI, Arial, sans-serif',
  },
  kanbanGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: 20,
    alignItems: 'start',
  },
  column: {
    border: '1px solid #1e293b',
    borderRadius: 12,
    padding: 16,
    background: '#0f172a',
    minHeight: 120,
  },
  columnHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  columnTitle: { margin: 0, fontSize: '1.1rem', textTransform: 'none' },
  columnSubtitle: { margin: '6px 0 14px', fontSize: 13, color: '#64748b' },
  countBadge: {
    background: '#334155',
    color: '#f1f5f9',
    fontSize: 13,
    fontWeight: 700,
    padding: '2px 10px',
    borderRadius: 999,
  },
  empty: { color: '#475569', fontSize: 14 },
  card: {
    background: '#1e293b',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    border: '1px solid #334155',
  },
  cardTitleRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    alignItems: 'flex-start',
  },
  metaRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 8,
    flexWrap: 'wrap',
  },
  stationPill: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    background: '#0f172a',
    color: '#94a3b8',
    padding: '2px 8px',
    borderRadius: 6,
    border: '1px solid #334155',
  },
  qtyBadge: { flexShrink: 0, fontWeight: 700, color: '#38bdf8' },
  modifierList: { margin: '8px 0 0 16px', color: '#cbd5e1' },
  note: { margin: '8px 0 0', color: '#facc15' },
  actions: { display: 'flex', gap: 8, marginTop: 12 },
  prepareButton: {
    flex: 1,
    border: 'none',
    padding: '10px 12px',
    borderRadius: 8,
    background: '#b45309',
    color: 'white',
    cursor: 'pointer',
    fontWeight: 600,
  },
  doneButton: {
    flex: 1,
    border: 'none',
    padding: '10px 12px',
    borderRadius: 8,
    background: '#166534',
    color: 'white',
    cursor: 'pointer',
    fontWeight: 600,
  },
  errorBox: {
    marginBottom: 12,
    border: '1px solid #7f1d1d',
    background: 'rgba(127, 29, 29, 0.25)',
    color: '#fecaca',
    borderRadius: 8,
    padding: 10,
  },
  retryButton: {
    marginTop: 8,
    border: '1px solid #b91c1c',
    background: 'transparent',
    color: '#fecaca',
    borderRadius: 6,
    padding: '6px 10px',
    cursor: 'pointer',
  },
}

export default function KitchenPage() {
  return (
    <RoleGate>
      <KitchenScreen />
    </RoleGate>
  )
}
