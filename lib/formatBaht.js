/** แสดงยอดเงินเป็น THB (ใช้ร่วมหน้าชำระ / POS / เมนู) */
export function formatBaht(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return '—'
  return x.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}
