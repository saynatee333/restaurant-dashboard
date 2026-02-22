"use client"

export const dynamic = "force-dynamic"

import { useState } from "react"

export default function Page() {
  const [orders, setOrders] = useState([
    { table: "A1", menu: "ผัดไทย", price: 80, status: "เสิร์ฟแล้ว" },
    { table: "B3", menu: "ข้าวผัด", price: 70, status: "กำลังทำ" }
  ])

  const addOrder = () => {
    const newOrder = {
      table: "C1",
      menu: "ต้มยำ",
      price: 120,
      status: "กำลังทำ"
    }
    setOrders([...orders, newOrder])
  }

  const groupedOrders = orders.reduce((acc, order) => {
    if (!acc[order.table]) {
      acc[order.table] = []
    }
    acc[order.table].push(order)
    return acc
  }, {})

  return (
    <main style={mainStyle}>
      <h1>📊 Restaurant Dashboard</h1>

      <div style={gridStyle}>
        <Card
  title="💰 ยอดขายวันนี้"
  value={`฿${orders.reduce((sum, o) => sum + o.price, 0)}`}
/>
        <Card title="🧾 จำนวนออเดอร์" value={orders.length} />
        <Card title="🍜 เมนูทั้งหมด" value="18 เมนู" />
      </div>

      <h2 style={{ marginTop: "40px" }}>🕒 ออเดอร์ล่าสุด</h2>

      <div style={tableWrapper}>
        {Object.entries(groupedOrders).map(([table, tableOrders]) => {
  const tableTotal = tableOrders.reduce(
    (sum, order) => sum + order.price,
    0
  )

  return (
    <div key={table} style={tableCard}>
      <h3 style={{ marginBottom: "10px" }}>
        โต๊ะ {table}
      </h3>

      {tableOrders.map((order, index) => (
        <div key={index} style={rowStyle}>
          <div>{order.menu}</div>
          <div>฿{order.price}</div>
          <div
            style={{
              color:
                order.status === "เสิร์ฟแล้ว"
                  ? "#22c55e"
                  : "#facc15"
            }}
          >
            {order.status}
          </div>
        </div>
      ))}

      {/* 💰 ยอดรวมโต๊ะ */}
      <div style={totalStyle}>
        รวมโต๊ะนี้: ฿{tableTotal}
      </div>
    </div>
  )
})}
</div>
      <button style={floatingButton} onClick={addOrder}>
        +
      </button>
    </main>
  )
}

function Card({ title, value }) {
  return (
    <div style={cardStyle}>
      <h3>{title}</h3>
      <p style={valueStyle}>{value}</p>
    </div>
  )
}

const mainStyle = {
  padding: "40px",
  minHeight: "100vh",
  background: "linear-gradient(to right, #0f172a, #1e293b)",
  color: "white",
  fontFamily: "Arial"
}

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
  gap: "20px",
  marginBottom: "30px"
}

const cardStyle = {
  background: "rgba(255,255,255,0.05)",
  padding: "20px",
  borderRadius: "16px",
  border: "1px solid rgba(255,255,255,0.1)"
}

const valueStyle = {
  fontSize: "26px",
  fontWeight: "bold",
  marginTop: "10px"
}

const tableWrapper = {
  background: "rgba(255,255,255,0.05)",
  padding: "20px",
  borderRadius: "16px",
  border: "1px solid rgba(255,255,255,0.1)"
}

const tableCard = {
  marginBottom: "20px",
  padding: "15px",
  borderRadius: "12px",
  background: "rgba(255,255,255,0.05)"
}

const rowStyle = {
  display: "grid",
  gridTemplateColumns: "2fr 1fr 1fr",
  padding: "8px 0",
  borderBottom: "1px solid rgba(255,255,255,0.1)"
}

const floatingButton = {
  position: "fixed",
  bottom: "90px",
  right: "20px",
  width: "60px",
  height: "60px",
  borderRadius: "50%",
  fontSize: "28px",
  background: "#22c55e",
  color: "white",
  border: "none",
  boxShadow: "0 8px 20px rgba(0,0,0,0.3)",
  cursor: "pointer",
  zIndex: 9999
}
const totalStyle = {
  marginTop: "10px",
  paddingTop: "10px",
  borderTop: "1px solid rgba(255,255,255,0.2)",
  fontWeight: "bold",
  textAlign: "right",
  color: "#22c55e"
}