'use client'

import { useCallback, useEffect, useState } from 'react'
import { RoleGate } from '@/components/RoleGate'
import { useBranchContext } from '@/context/BranchContext'
import { useAdminPaymentFailureNotification } from '@/hooks/useAdminPaymentFailureNotification'
import { scopeBranchOrLegacyNull } from '@/lib/supabaseBranchScope'
import { supabase } from '@/lib/supabase'

function AdminDashboardInner() {
  const { effectiveBranchId } = useBranchContext()
  const [orders, setOrders] = useState([])
  const { lastFailure, clearFailure } = useAdminPaymentFailureNotification()

  const fetchActiveOrders = useCallback(async () => {
    let q = supabase
      .from('orders')
      .select(
        'id, branch_id, table_id, status, total_amount, created_at, order_items(qty, menu_items(name))'
      )
      .not('status', 'in', '(paid,cancelled)')
      .order('created_at', { ascending: false })

    if (effectiveBranchId) q = scopeBranchOrLegacyNull(q, effectiveBranchId, 'branch_id')

    let result = await q

    if (result.error) {
      let q2 = supabase
        .from('orders')
        .select(
          'id, branch_id, table_id, status, total_amount, created_at, order_items(qty, menu(name))'
        )
        .not('status', 'in', '(paid,cancelled)')
        .order('created_at', { ascending: false })
      if (effectiveBranchId) q2 = scopeBranchOrLegacyNull(q2, effectiveBranchId, 'branch_id')
      result = await q2
    }

    if (result.error) console.error(result.error)
    else setOrders(result.data || [])
  }, [effectiveBranchId])

  useEffect(() => {
    void fetchActiveOrders()
    const channel = supabase
      .channel('admin-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () =>
        void fetchActiveOrders()
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchActiveOrders])

  const updateStatus = async (orderId, newStatus) => {
    const { error } = await supabase.rpc('pos_transition_order_status', {
      p_order_id: orderId,
      p_next_status: newStatus,
    })

    if (error) {
      alert('เกิดข้อผิดพลาด: ' + error.message)
    } else {
      void fetchActiveOrders()
    }
  }

  const nextActions = (status) => {
    if (status === 'pending')
      return [{ id: 'in_progress', label: 'เริ่มทำ', style: startButtonStyle }]
    if (status === 'in_progress')
      return [{ id: 'served', label: 'พร้อมเสิร์ฟ', style: serveButtonStyle }]
    if (status === 'served')
      return [{ id: 'paid', label: 'ชำระเงินแล้ว', style: paidButtonStyle }]
    return []
  }

  return (
    <div
      style={{
        padding: '40px',
        background: '#0f172a',
        minHeight: '100vh',
        color: 'white',
        fontFamily: 'sans-serif',
      }}
    >
      <h1 style={{ textAlign: 'center', marginBottom: '40px' }}>
        👨‍🍳 รายการสั่งอาหาร (แอดมิน)
      </h1>
      {lastFailure ? (
        <div
          role="status"
          style={{
            marginBottom: 16,
            border: '1px solid #7f1d1d',
            background: '#450a0a',
            color: '#fecaca',
            borderRadius: 10,
            padding: '10px 12px',
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            alignItems: 'center',
          }}
        >
          <span>{lastFailure.message}</span>
          <button
            type="button"
            style={{
              background: 'transparent',
              color: '#fecaca',
              border: '1px solid #b91c1c',
              borderRadius: 6,
              padding: '4px 8px',
              cursor: 'pointer',
            }}
            onClick={clearFailure}
          >
            ปิด
          </button>
        </div>
      ) : null}

      {orders.length === 0 ? (
        <p style={{ textAlign: 'center', color: '#64748b' }}>ไม่มีรายการค้างในระบบ</p>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
            gap: '20px',
          }}
        >
          {orders.map((order) => (
            <div
              key={order.id}
              style={{
                background: '#1e293b',
                padding: '20px',
                borderRadius: '15px',
                border: '1px solid #334155',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
                <h2 style={{ margin: 0 }}>โต๊ะที่ {order.table_id}</h2>
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>ID: #{order.id}</span>
              </div>

              <p style={{ margin: '8px 0', color: '#cbd5e1' }}>สถานะ: {order.status}</p>
              <p style={{ margin: '8px 0', color: '#4ade80' }}>
                ยอดรวม: ฿{Number(order.total_amount || 0).toFixed(2)}
              </p>

              <ul style={{ paddingLeft: '20px', marginBottom: '20px' }}>
                {(order.order_items || []).map((item, i) => (
                  <li key={i} style={{ marginBottom: '8px' }}>
                    {item.menu_items?.name || item.menu?.name || 'Unknown menu'}{' '}
                    <span style={{ fontWeight: 'bold', color: '#4ade80' }}>x {item.qty}</span>
                  </li>
                ))}
              </ul>

              <div style={{ display: 'flex', gap: '10px' }}>
                {nextActions(order.status).map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => void updateStatus(order.id, action.id)}
                    style={action.style}
                  >
                    {action.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => void updateStatus(order.id, 'cancelled')}
                  style={cancelButtonStyle}
                >
                  ❌ ยกเลิก
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function AdminDashboard() {
  return (
    <RoleGate>
      <AdminDashboardInner />
    </RoleGate>
  )
}

const baseButtonStyle = {
  flex: 1,
  color: 'white',
  border: 'none',
  padding: '12px',
  borderRadius: '8px',
  cursor: 'pointer',
  fontWeight: 'bold',
}
const startButtonStyle = { ...baseButtonStyle, background: '#1d4ed8' }
const serveButtonStyle = { ...baseButtonStyle, background: '#0f766e' }
const paidButtonStyle = { ...baseButtonStyle, background: '#166534' }
const cancelButtonStyle = { ...baseButtonStyle, background: '#991b1b' }
