import { jsonErr, jsonOk, withRouteHandler } from '@/lib/api/http'
import { logInfo, logWarn } from '@/lib/logger'

export const dynamic = 'force-dynamic'

export const POST = withRouteHandler('POST /api/ops/events', async (request) => {
  const body = await request.json().catch(() => null)
  const event = typeof body?.event === 'string' ? body.event.trim() : ''
  const ts = body?.ts || new Date().toISOString()
  const meta = body?.meta && typeof body.meta === 'object' ? body.meta : {}

  if (!event) {
    return jsonErr('event is required', { code: 'BAD_REQUEST', status: 400 })
  }

  if (event.length > 120) {
    return jsonErr('event too long', { code: 'BAD_REQUEST', status: 400 })
  }

  // Basic monitoring log sink (stdout JSON via logger).
  if (event.includes('failure') || event.includes('error')) {
    logWarn('ops_event', { event, ts, meta })
  } else {
    logInfo('ops_event', { event, ts, meta })
  }

  return jsonOk({ accepted: true })
})
