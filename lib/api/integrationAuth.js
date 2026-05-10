import { getIntegrationApiKey } from '@/lib/env'

/** True when `INTEGRATION_API_KEY` is set and request presents the same key. */
export function isIntegrationRequest(request) {
  const expected = getIntegrationApiKey()
  if (!expected) return false
  const headerKey = request.headers.get('x-api-key')
  const auth = request.headers.get('authorization')
  const bearer = auth?.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null
  const provided = headerKey?.trim() || bearer
  return Boolean(provided && provided === expected)
}

/** Optional branch scope from integration headers */
export function integrationBranchId(request) {
  const raw = request.headers.get('x-branch-id')
  return raw?.trim() || null
}
