/**
 * แปลง error จาก Supabase / fetch / RPC ให้เป็นข้อความอ่านได้ใน UI
 * @param {unknown} err
 * @returns {string}
 */
export function formatUnknownError(err) {
  if (err == null) return 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ'
  if (typeof err === 'string') return err
  if (typeof err === 'number' || typeof err === 'boolean') return String(err)

  if (err instanceof Error) {
    const m = typeof err.message === 'string' ? err.message.trim() : ''
    if (m && m !== '[object Object]') return m
  }

  if (typeof err === 'object') {
    const o = /** @type {Record<string, unknown>} */ (err)
    const candidates = [
      o.message,
      o.error_description,
      o.details,
      o.hint,
      typeof o.error === 'string' ? o.error : null,
    ]
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim()) return c.trim()
    }
    if (o.error && typeof o.error === 'object') {
      const e2 = /** @type {Record<string, unknown>} */ (o.error)
      const nested = e2.message ?? e2.error ?? e2.detail
      if (typeof nested === 'string' && nested.trim()) return nested.trim()
    }
    if (typeof o.code === 'string' && o.code.trim()) {
      return `รหัสข้อผิดพลาด: ${o.code}`
    }
    try {
      const s = JSON.stringify(err)
      if (s && s !== '{}') return s
    } catch {
      /* ignore */
    }
  }

  return 'ข้อผิดพลาดจากเซิร์ฟเวอร์'
}
