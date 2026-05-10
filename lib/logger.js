/**
 * Lightweight structured logging (server + browser).
 * Server: JSON lines to stdout for log drains.
 * Client: console + optional forward hook later.
 */

const IS_SERVER = typeof window === 'undefined'

function emit(level, msg, meta) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(meta && typeof meta === 'object' ? meta : {}),
  }
  if (IS_SERVER) {
    const line = JSON.stringify(payload)
    if (level === 'error') console.error(line)
    else if (level === 'warn') console.warn(line)
    else console.log(line)
  } else if (process.env.NODE_ENV === 'development') {
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
    fn(`[${level}] ${msg}`, meta ?? '')
  }
}

/** @param {string} msg */
export function logInfo(msg, meta) {
  emit('info', msg, meta)
}

/** @param {string} msg */
export function logWarn(msg, meta) {
  emit('warn', msg, meta)
}

/** @param {string} msg */
export function logError(msg, meta) {
  emit('error', msg, meta)
}
