import { formatUnknownError } from '@/lib/formatUnknownError'

/** ช่วยเช็คผล JSON จาก RPC แบบ `{ ok: true, ... }` (เช่น pos_*) */

export function rpcMessage(data) {
  if (!data || typeof data !== 'object') return 'ไม่ทราบสาเหตุ'
  const raw = /** @type {Record<string, unknown>} */ (data).message
  const rawErr = /** @type {Record<string, unknown>} */ (data).error

  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  if (typeof rawErr === 'string' && rawErr.trim()) return rawErr.trim()
  if (rawErr && typeof rawErr === 'object') {
    const o = /** @type {Record<string, unknown>} */ (rawErr)
    const nested = o.message ?? o.detail ?? o.error
    if (typeof nested === 'string' && nested.trim()) return nested.trim()
    try {
      return JSON.stringify(rawErr)
    } catch {
      return 'คำขอไม่สำเร็จ'
    }
  }
  return 'คำขอไม่สำเร็จ'
}

export function isRpcOk(data) {
  return Boolean(data && typeof data === 'object' && data.ok === true)
}

/** @param {{ data: unknown, error: Error | null }} result */
export function assertRpcOk(result) {
  if (result.error) {
    throw new Error(formatUnknownError(result.error))
  }
  const data = result.data
  if (!isRpcOk(data)) {
    throw new Error(rpcMessage(data))
  }
  return data
}
