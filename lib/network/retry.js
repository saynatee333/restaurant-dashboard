function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * @param {unknown} err
 */
export function isLikelyNetworkError(err) {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : typeof err === 'object' && err && 'message' in err
          ? String(err.message || '')
          : ''
  const m = msg.toLowerCase()
  return (
    m.includes('failed to fetch') ||
    m.includes('network') ||
    m.includes('timed out') ||
    m.includes('timeout') ||
    m.includes('fetch') ||
    m.includes('networkerror')
  )
}

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ retries?: number, baseDelayMs?: number, maxDelayMs?: number, shouldRetry?: (err: unknown) => boolean }} [options]
 * @returns {Promise<T>}
 */
export async function withRetry(fn, options = {}) {
  const retries = Number.isFinite(options.retries) ? Math.max(0, options.retries) : 2
  const baseDelayMs = options.baseDelayMs ?? 250
  const maxDelayMs = options.maxDelayMs ?? 1200
  const shouldRetry = options.shouldRetry ?? isLikelyNetworkError

  let attempt = 0
  while (true) {
    try {
      return await fn()
    } catch (err) {
      if (attempt >= retries || !shouldRetry(err)) throw err
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt)
      await sleep(delay)
      attempt += 1
    }
  }
}
