export default function Page() {
  return (
    <main style={{ padding: "40px", fontFamily: "Arial" }}>
      <h1>📊 Restaurant Dashboard</h1>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
        gap: "20px",
        marginTop: "30px"
      }}>
        <div style={cardStyle}>
          <h3>💰 ยอดขายวันนี้</h3>
          <p style={numberStyle}>฿12,500</p>
        </div>

        <div style={cardStyle}>
          <h3>🧾 จำนวนออเดอร์</h3>
          <p style={numberStyle}>32</p>
        </div>

        <div style={cardStyle}>
          <h3>🍜 เมนูทั้งหมด</h3>
          <p style={numberStyle}>18 เมนู</p>
        </div>
      </div>

      <h2 style={{ marginTop: "50px" }}>🕒 ออเดอร์ล่าสุด</h2>

      <table style={{
        width: "100%",
        marginTop: "20px",
        borderCollapse: "collapse"
      }}>
        <thead>
          <tr>
            <th style={thStyle}>โต๊ะ</th>
            <th style={thStyle}>เมนู</th>
            <th style={thStyle}>ราคา</th>
            <th style={thStyle}>สถานะ</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={tdStyle}>A1</td>
            <td style={tdStyle}>ผัดไทย</td>
            <td style={tdStyle}>฿80</td>
            <td style={tdStyle}>เสิร์ฟแล้ว</td>
          </tr>
          <tr>
            <td style={tdStyle}>B3</td>
            <td style={tdStyle}>ข้าวผัด</td>
            <td style={tdStyle}>฿70</td>
            <td style={tdStyle}>กำลังทำ</td>
          </tr>
        </tbody>
      </table>
    </main>
  )
}

const cardStyle = {
  background: "#ffffff",
  padding: "20px",
  borderRadius: "12px",
  boxShadow: "0 4px 10px rgba(0,0,0,0.1)"
}

const numberStyle = {
  fontSize: "24px",
  fontWeight: "bold",
  marginTop: "10px"
}

const thStyle = {
  borderBottom: "1px solid #ddd",
  padding: "10px",
  textAlign: "left"
}

const tdStyle = {
  borderBottom: "1px solid #eee",
  padding: "10px"
}
