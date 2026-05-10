const PRODUCTS_CACHE_PREFIX = 'rd-pos-products:'
const QUEUE_KEY = 'rd-pos-offline-queue:v1'

const PRODUCTS_TTL_MS = 24 * 60 * 60 * 1000

function getStore() {
  if (typeof window === 'undefined') return null
  return window.localStorage
}

function now() {
  return Date.now()
}

/**
 * @param {string | null | undefined} branchId
 */
function productsKey(branchId) {
  return PRODUCTS_CACHE_PREFIX + (branchId || 'all')
}

/**
 * @param {string | null | undefined} branchId
 * @param {Array<Record<string, unknown>>} products
 */
export function savePosProductsCache(branchId, products) {
  const store = getStore()
  if (!store) return
  try {
    store.setItem(
      productsKey(branchId),
      JSON.stringify({ savedAt: now(), products: Array.isArray(products) ? products : [] })
    )
  } catch {
    // ignore quota / private mode
  }
}

/**
 * @param {string | null | undefined} branchId
 */
export function loadPosProductsCache(branchId) {
  const store = getStore()
  if (!store) return null
  try {
    const raw = store.getItem(productsKey(branchId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.savedAt || now() - parsed.savedAt > PRODUCTS_TTL_MS) {
      return null
    }
    return Array.isArray(parsed.products) ? parsed.products : null
  } catch {
    return null
  }
}

export function readPosOfflineQueue() {
  const store = getStore()
  if (!store) return []
  try {
    const raw = store.getItem(QUEUE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * @param {Array<Record<string, unknown>>} queue
 */
export function writePosOfflineQueue(queue) {
  const store = getStore()
  if (!store) return
  try {
    store.setItem(QUEUE_KEY, JSON.stringify(Array.isArray(queue) ? queue : []))
  } catch {
    // ignore quota / private mode
  }
}

/**
 * @param {{ type: string, payload: Record<string, unknown>, branchId?: string | null }} action
 */
export function enqueuePosOfflineAction(action) {
  const queue = readPosOfflineQueue()
  const generatedId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `q_${now()}_${Math.random().toString(16).slice(2)}`
  const item = {
    id: generatedId,
    type: action.type,
    payload: action.payload,
    branchId: action.branchId ?? null,
    attempts: 0,
    createdAt: new Date().toISOString(),
  }
  queue.push(item)
  writePosOfflineQueue(queue)
  return item
}

/**
 * Remove one queue item by id.
 * @param {string} id
 */
export function removePosOfflineAction(id) {
  const queue = readPosOfflineQueue().filter((x) => x.id !== id)
  writePosOfflineQueue(queue)
}

/**
 * @param {string} id
 * @param {string} message
 */
export function markPosOfflineActionAttempt(id, message) {
  const queue = readPosOfflineQueue()
  const idx = queue.findIndex((x) => x.id === id)
  if (idx < 0) return
  queue[idx] = {
    ...queue[idx],
    attempts: Number(queue[idx].attempts || 0) + 1,
    lastError: message,
    lastTriedAt: new Date().toISOString(),
  }
  writePosOfflineQueue(queue)
}

/**
 * Merge partial fields into one queue item.
 * @param {string} id
 * @param {Record<string, unknown>} patch
 */
export function updatePosOfflineAction(id, patch) {
  const queue = readPosOfflineQueue()
  const idx = queue.findIndex((x) => x.id === id)
  if (idx < 0) return
  queue[idx] = { ...queue[idx], ...patch }
  writePosOfflineQueue(queue)
}
