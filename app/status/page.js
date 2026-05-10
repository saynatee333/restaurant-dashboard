"use client"
import { Suspense, useState, useEffect } from "react"
import { supabase } from "../../lib/supabase"
import { useSearchParams } from "next/navigation"

export default function StatusPage() {
  return (
    <Suspense fallback={<div style={msgStyle}>กำลังโหลดข้อมูล...</div>}>
      <StatusContent />
    </Suspense>
  )
}

function StatusContent() {
  const searchParams = useSearchParams()
  const tableId = searchParams.get('table')
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!tableId) return

    const fetchStatus = async () => {
      // ดึงออเดอร์ของโต๊ะนี้ที่สถานะยังไม่ใช่ 'paid' (คือยังกินอยู่)
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id,
          status,
          created_at,
          order_items (
            qty,
            menu ( name )
          )
        `)
        .eq('table_id', tableId)
        .neq('status', 'paid') // ไม่แสดงออเดอร์ที่จ่ายเงินไปแล้ว
        .order('created_at', { ascending: false })

      if (error) {
        console.error(error)
      } else {
        setOrders(data)
      }
      setLoading(false)
    }

    fetchStatus()

    // --- Realtime Update: เมื่อพนักงานแก้สถานะ หน้าจอลูกค้าจะเปลี่ยนทันที ---
    const channel = supabase
      .channel('order-updates')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, fetchStatus)
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [tableId])

  if (!tableId) return <div style={msgStyle}>❌ กรุณาสแกน QR Code ที่โต๊ะ</div>
  if (loading) return <div style={msgStyle}>กำลังโหลดข้อมูล...</div>

  // ส่วนแสดงผลในไฟล์ status/page.js
return (
  <main style={mainStyle}>
    <h2 style={{ textAlign: 'center', margin: '20px 0' }}>📋 รายการอาหาร โต๊ะที่ {tableId}</h2>
    
    {!orders || orders.length === 0 ? (
      <div style={msgStyle}>ยังไม่มีรายการอาหารครับ</div>
    ) : (
      <div style={orderCardStyle}>
        <div style={headerStyle}>
          <span>รายการทั้งหมด</span>
          <span style={statusBadge('pending')}>รอรับอาหาร</span>
        </div>
        <hr style={{ borderColor: 'rgba(255,255,255,0.1)', margin: '15px 0' }} />
        
        {/* รวมยอดอาหารชื่อเดียวกันมาไว้ด้วยกัน */}
        {Object.entries(
          orders.flatMap(o => o.order_items).reduce((acc, item) => {
            const name = item.menu.name;
            acc[name] = (acc[name] || 0) + item.qty;
            return acc;
          }, {})
        ).map(([name, qty], idx) => (
          <div key={idx} style={itemStyle}>
            <span style={{ fontSize: '18px' }}>{name}</span>
            <span style={{ fontWeight: 'bold' }}>x {qty}</span>
          </div>
        ))}
      </div>
    )}
  </main>
);
}
// --- Styles ---
const mainStyle = { padding: "20px", minHeight: "100vh", background: "#0f172a", color: "white", fontFamily: "Arial" }
const orderCardStyle = { background: "rgba(255,255,255,0.08)", borderRadius: "16px", padding: "20px", marginBottom: "15px", border: "1px solid rgba(255,255,255,0.1)" }
const headerStyle = { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px", fontWeight: "bold" }
const itemStyle = { display: "flex", justifyContent: "space-between", padding: "8px 0", color: "#cbd5e1" }
const timeStyle = { fontSize: "12px", color: "#64748b", marginTop: "10px", textAlign: "right" }
const msgStyle = { textAlign: "center", padding: "50px", color: "#94a3b8" }

const statusBadge = (status) => ({
  padding: "5px 12px",
  borderRadius: "20px",
  fontSize: "12px",
  fontWeight: "bold",
  // ปรับสีตามสถานะที่มีใน ARRAY ของคุณ
  background: status === 'pending' ? '#3b82f6' : 
              status === 'success' ? '#22c55e' : 
              status === 'paid' ? '#94a3b8' : '#475569',
  color: 'white'
})