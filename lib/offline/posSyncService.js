import { addItemToOrder, createOrder, submitOrder, supabase } from '@/lib/supabase'
import { assertRpcOk, isRpcOk, rpcMessage } from '@/lib/supabaseRpc'
import {
  markPosOfflineActionAttempt,
  readPosOfflineQueue,
  removePosOfflineAction,
  updatePosOfflineAction,
} from '@/lib/offline/posOfflineStorage'

const MAX_ATTEMPTS = 8
let activeSyncPromise = null

/**
 * @param {string} tableCode
 * @returns {Promise<string>}
 */
async function resolveOrderIdForTable(tableCode) {
  const created = await createOrder(tableCode)
  if (!created.error && isRpcOk(created.data)) {
    return created.data.order_id
  }

  const body = created.data
  if (
    body &&
    typeof body === 'object' &&
    body.error === 'table_has_open_order' &&
    body.table_id
  ) {
    const { data: row, error: qErr } = await supabase
      .from('orders')
      .select('id')
      .eq('table_id', body.table_id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (qErr) throw new Error(qErr.message || 'โหลดบิลโต๊ะไม่สำเร็จระหว่าง sync')
    if (row?.id) return row.id
    throw new Error('โต๊ะนี้มีบิลเปิดอยู่ แต่ไม่พบบิล pending สำหรับ sync')
  }

  throw new Error(created.error?.message || rpcMessage(body) || 'เปิดบิลไม่สำเร็จ')
}

/**
 * @param {Record<string, unknown>} item
 */
async function syncCreateOrderFlow(item) {
  const payload = item.payload || {}
  const tableCode = String(payload.tableCode || '').trim()
  const lines = Array.isArray(payload.lines) ? payload.lines : []
  const progress = payload.progress && typeof payload.progress === 'object' ? payload.progress : {}

  if (!tableCode) throw new Error('queue payload ไม่มี tableCode')
  if (!lines.length) throw new Error('queue payload ไม่มี line items')

  let orderId = progress.orderId ? String(progress.orderId) : ''
  if (!orderId) {
    orderId = await resolveOrderIdForTable(tableCode)
    updatePosOfflineAction(item.id, {
      payload: { ...payload, progress: { ...progress, orderId } },
    })
  }

  const addedProductIds = new Set(
    Array.isArray(progress.addedProductIds) ? progress.addedProductIds.map(String) : []
  )

  for (const line of lines) {
    const productId = String(line.id || '')
    const qty = Number(line.qty || 0)
    if (!productId || qty <= 0) continue
    if (addedProductIds.has(productId)) continue
    assertRpcOk(await addItemToOrder(orderId, productId, qty))
    addedProductIds.add(productId)
    updatePosOfflineAction(item.id, {
      payload: {
        ...payload,
        progress: { ...progress, orderId, addedProductIds: Array.from(addedProductIds) },
      },
    })
  }

  if (!progress.submitted) {
    assertRpcOk(await submitOrder(orderId))
    updatePosOfflineAction(item.id, {
      payload: {
        ...payload,
        progress: {
          ...progress,
          orderId,
          addedProductIds: Array.from(addedProductIds),
          submitted: true,
        },
      },
    })
  }
}

/**
 * @param {Record<string, unknown>} item
 */
async function syncOne(item) {
  if (item.type === 'CREATE_ORDER_FLOW') {
    await syncCreateOrderFlow(item)
    return
  }
  throw new Error(`ไม่รู้จัก queue action type: ${item.type}`)
}

/**
 * Process offline queue sequentially.
 * Conflict-safe strategy:
 * - For table_has_open_order we reuse existing pending order and continue.
 * - Failed items are kept with attempts counter for later retry.
 */
export async function runPosOfflineSync() {
  if (activeSyncPromise) return activeSyncPromise
  activeSyncPromise = (async () => {
  const queue = readPosOfflineQueue()
  if (!queue.length) return { processed: 0, succeeded: 0, failed: 0 }

  let processed = 0
  let succeeded = 0
  let failed = 0

  for (const item of queue) {
    processed += 1
    try {
      await syncOne(item)
      removePosOfflineAction(item.id)
      succeeded += 1
    } catch (e) {
      failed += 1
      markPosOfflineActionAttempt(item.id, e.message || String(e))
      const attempts = Number(item.attempts || 0) + 1
      if (attempts >= MAX_ATTEMPTS) {
        // Drop poison messages after many retries to keep queue healthy.
        removePosOfflineAction(item.id)
      }
    }
  }

  return { processed, succeeded, failed }
  })()

  try {
    return await activeSyncPromise
  } finally {
    activeSyncPromise = null
  }
}
