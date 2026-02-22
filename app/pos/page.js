export default function Home() {
  return (
    <div style={{ padding: 40 }}>
      <h1>Restaurant System</h1>

      <div style={{ marginTop: 20 }}>
        <a href="/pos">
          <button>เข้า POS</button>
        </a>

        <a href="/dashboard" style={{ marginLeft: 20 }}>
          <button>เข้า Dashboard</button>
        </a>
      </div>
    </div>
  )
}
