const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const TABLE_CODE_RE = /^[A-Za-z0-9_-]{1,24}$/

/**
 * @param {unknown} value
 * @param {string} fieldName
 */
export function requireUuid(value, fieldName) {
  const s = String(value || '').trim()
  if (!UUID_RE.test(s)) {
    throw new Error(`${fieldName} ต้องเป็น UUID ที่ถูกต้อง`)
  }
  return s
}

/**
 * @param {unknown} value
 * @param {string} fieldName
 */
export function requirePositiveInt(value, fieldName) {
  const n = Number.parseInt(String(value), 10)
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${fieldName} ต้องเป็นจำนวนเต็มมากกว่า 0`)
  }
  return n
}

/**
 * @param {unknown} value
 */
export function requireTableCode(value) {
  const code = String(value || '').trim()
  if (!TABLE_CODE_RE.test(code)) {
    throw new Error('table code ไม่ถูกต้อง (ใช้ a-z, 0-9, _, - ได้ไม่เกิน 24 ตัว)')
  }
  return code
}

/**
 * @param {unknown} value
 */
export function optionalDayIso(value) {
  const s = typeof value === 'string' ? value.slice(0, 10) : ''
  if (!s) return new Date().toISOString().slice(0, 10)
  if (!DAY_RE.test(s)) {
    throw new Error('day ต้องอยู่ในรูปแบบ YYYY-MM-DD')
  }
  return s
}

/**
 * @param {unknown} value
 */
export function requirePaymentMethod(value) {
  const m = String(value || '').trim().toLowerCase()
  if (m !== 'cash' && m !== 'card' && m !== 'qr') {
    throw new Error('method ต้องเป็น cash, card หรือ qr')
  }
  return m
}

/**
 * @param {unknown} value
 * @param {string} fieldName
 */
export function requirePositiveAmount(value, fieldName = 'amount') {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${fieldName} ต้องมากกว่า 0`)
  }
  return n
}
