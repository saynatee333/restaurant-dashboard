"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function CustomerDisplayPage() {
  return (
    <Suspense fallback={<main style={pageStyle}>กำลังโหลดหน้าจอลูกค้า...</main>}>
      <CustomerDisplayContent />
    </Suspense>
  );
}

function CustomerDisplayContent() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get("order");
  const [order, setOrder] = useState(null);
  const [paying, setPaying] = useState(false);

  const fetchOrder = useCallback(async () => {
    if (!orderId) return;
    const { data } = await supabase
      .from("orders")
      .select("id, table_id, status, total_amount, order_items(qty, price, line_total, note, menus(name), menu_items(name))")
      .eq("id", orderId)
      .single();
    setOrder(data || null);
  }, [orderId]);

  useEffect(() => {
    if (!orderId) return;
    fetchOrder();
    const channel = supabase
      .channel(`customer-display-${orderId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, fetchOrder)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items" }, fetchOrder)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [orderId, fetchOrder]);

  const qrPayload = useMemo(() => {
    const amount = Number(order?.total_amount || 0).toFixed(2);
    return `PAY|ORDER:${order?.id || "-"}|AMOUNT:${amount}`;
  }, [order]);

  const handleMarkPaid = async () => {
    if (!order) return;
    setPaying(true);
    const { error } = await supabase.rpc("pos_payment_callback", {
      p_order_id: order.id,
      p_method: "qr",
      p_amount: Number(order.total_amount || 0),
      p_reference_code: `QR-${Date.now()}`,
    });
    setPaying(false);
    if (error) {
      alert("ชำระเงินไม่สำเร็จ: " + error.message);
      return;
    }
    await fetchOrder();
  };

  if (!orderId) {
    return <main style={pageStyle}>กรุณาระบุ `?order=ORDER_ID`</main>;
  }

  return (
    <main style={pageStyle}>
      <h1>Customer Display</h1>
      {!order ? (
        <p style={{ color: "#94a3b8" }}>ไม่พบออเดอร์</p>
      ) : (
        <section style={cardStyle}>
          <h2>Order #{order.id}</h2>
          <p>โต๊ะ: {order.table_id || "-"}</p>
          <p>สถานะ: {order.status}</p>
          <hr style={{ borderColor: "#334155" }} />

          {(order.order_items || []).map((item, idx) => {
            const menuRef = item.menu_items || item.menus;
            const total = item.line_total ?? Number(item.price || 0) * Number(item.qty || 0);
            return (
              <div key={idx} style={rowStyle}>
                <span>{menuRef?.name || "Unknown"} x{item.qty}</span>
                <strong>฿{Number(total).toFixed(2)}</strong>
              </div>
            );
          })}
          <hr style={{ borderColor: "#334155" }} />
          <div style={rowStyle}>
            <span>ยอดรวมสุทธิ</span>
            <strong style={{ color: "#22c55e", fontSize: 22 }}>฿{Number(order.total_amount || 0).toFixed(2)}</strong>
          </div>
        </section>
      )}

      <section style={qrSectionStyle}>
        <h3>ชำระเงินด้วย QR</h3>
        <p style={{ color: "#94a3b8" }}>ให้ระบบ payment gateway สแกน payload ด้านล่าง</p>
        <pre style={qrPayloadStyle}>{qrPayload}</pre>
        <button
          style={payButtonStyle}
          disabled={!order || order.status === "paid" || paying}
          onClick={handleMarkPaid}
        >
          {paying ? "กำลังยืนยัน..." : order?.status === "paid" ? "ชำระแล้ว" : "ทดสอบ callback ชำระเงิน"}
        </button>
      </section>
    </main>
  );
}

const pageStyle = {
  minHeight: "100vh",
  background: "#020617",
  color: "white",
  padding: 24,
  fontFamily: "Arial",
};
const cardStyle = {
  border: "1px solid #334155",
  borderRadius: 12,
  padding: 16,
  background: "#0f172a",
  maxWidth: 680,
};
const rowStyle = {
  display: "flex",
  justifyContent: "space-between",
  margin: "8px 0",
};
const qrSectionStyle = {
  marginTop: 16,
  maxWidth: 680,
  border: "1px solid #334155",
  borderRadius: 12,
  padding: 16,
  background: "#0f172a",
};
const qrPayloadStyle = {
  background: "#111827",
  border: "1px solid #374151",
  borderRadius: 8,
  padding: 12,
  whiteSpace: "pre-wrap",
};
const payButtonStyle = {
  marginTop: 12,
  width: "100%",
  border: "none",
  background: "#16a34a",
  color: "white",
  fontWeight: "bold",
  borderRadius: 8,
  padding: "10px 14px",
  cursor: "pointer",
};
