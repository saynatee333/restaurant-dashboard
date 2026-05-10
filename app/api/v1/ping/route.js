import { jsonOk, withRouteHandler } from '@/lib/api/http'
import { logInfo } from '@/lib/logger'
import { isIntegrationRequest } from '@/lib/api/integrationAuth'

export const dynamic = 'force-dynamic'

/** Lightweight handshake for external integrations (optional API key). */
export const GET = withRouteHandler('GET /api/v1/ping', async (request) => {
  const integration = isIntegrationRequest(request)
  logInfo('GET /api/v1/ping', { integration })
  return jsonOk({
    pong: true,
    integration,
    timestamp: new Date().toISOString(),
  })
})
