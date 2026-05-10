import { NextResponse } from 'next/server'
import { logError } from '@/lib/logger'

/** @param {unknown} data */
export function jsonOk(data, init) {
  return NextResponse.json({ ok: true, ...data }, { status: 200, ...init })
}

/**
 * @param {string} message
 * @param {{ code?: string, status?: number, details?: unknown }} [opts]
 */
export function jsonErr(message, opts = {}) {
  const status = opts.status ?? 400
  const body = {
    ok: false,
    error: {
      code: opts.code ?? 'REQUEST_ERROR',
      message,
      ...(opts.details !== undefined ? { details: opts.details } : {}),
    },
  }
  return NextResponse.json(body, { status })
}

export function jsonUnauthorized(message = 'Unauthorized') {
  return jsonErr(message, { code: 'UNAUTHORIZED', status: 401 })
}

export function jsonForbidden(message = 'Forbidden') {
  return jsonErr(message, { code: 'FORBIDDEN', status: 403 })
}

/**
 * Wrap a Route Handler to catch errors → JSON 500 + structured log.
 * @param {string} routeLabel
 * @param {(req: import('next/server').NextRequest, ctx?: unknown) => Promise<Response>} handler
 */
export function withRouteHandler(routeLabel, handler) {
  return async (request, context) => {
    try {
      return await handler(request, context)
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e))
      logError(routeLabel, { message: err.message, stack: err.stack })
      return jsonErr('Internal server error', { code: 'INTERNAL', status: 500 })
    }
  }
}
