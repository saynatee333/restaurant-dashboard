export default function Page() {
  return (
    <main style={mainStyle}>
      <h1 style={titleStyle}>📊 Restaurant Dashboard</h1>

      <div style={gridStyle}>
        <Card title="💰 ยอดขายวันนี้" value="฿12,500" />
        <Card title="🧾 จำนวนออเดอร์" value="32" />
        <Card title="🍜 เมนูทั้งหมด" value="18 เมนู" />
      </div>

      <h2 style={{ marginTop: "50px" }}>🕒 ออเดอร์ล่าสุด</h2>

      <div style={tableWrapper}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th>โต๊ะ</th>
              <th>เมนู</th>
              <th>ราคา</th>
              <th>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>A1</td>
              <td>ผัดไทย</td>
              <td>฿80</td>
              <td style={{ color: "#4ade80" }}>เสิร์ฟแล้ว</td>
            </tr>
            <tr>
              <td>B3</td>
              <td>ข้าวผัด</td>
              <td>฿70</td>
              <td style={{ color: "#facc15" }}>กำลังทำ</td>
            </tr>
          </tbody>
        </table>
      </div>
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
  fontFamily: "Arial",
  minHeight: "100vh",
  background: "linear-gradient(to right, #0f172a, #1e293b)",
  color: "white"
}

const titleStyle = {
  fontSize: "32px",
  marginBottom: "30px"
}

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
  gap: "20px"
}

const cardStyle = {
  background: "rgba(255,255,255,0.05)",
  padding: "20px",
  borderRadius: "16px",
  backdropFilter: "blur(10px)",
  border: "1px solid rgba(255,255,255,0.1)"
}

const valueStyle = {
  fontSize: "28px",
  fontWeight: "bold",
  marginTop: "10px"
}

const tableWrapper = {
  marginTop: "20px",
  background: "rgba(255,255,255,0.05)",
  padding: "20px",
  borderRadius: "16px",
  border: "1px solid rgba(255,255,255,0.1)"
}

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse"
}
