/** @typedef {'admin' | 'cashier' | 'kitchen'} StaffRole */

export const STAFF_ROLES = /** @type {const} */ (['admin', 'cashier', 'kitchen'])

/** What each role may open (prefix match). Public guest routes omitted — see middleware. */
export const ROLE_ROUTE_PREFIXES = {
  admin: ['/dashboard', '/pos', '/floor', '/kitchen', '/admin', '/menu', '/pay'],
  cashier: ['/dashboard', '/pos', '/floor', '/menu', '/pay'],
  kitchen: ['/dashboard', '/kitchen'],
}

/**
 * Path-based RBAC for RoleGate (longest prefix wins).
 * `null` = no role restriction beyond "logged in".
 * @type {Array<{ prefix: string, roles: StaffRole[] }>}
 */
const PATH_ROLE_RULES = [
  { prefix: '/admin', roles: ['admin'] },
  { prefix: '/kitchen', roles: ['admin', 'kitchen'] },
  { prefix: '/pos', roles: ['admin', 'cashier'] },
  { prefix: '/floor', roles: ['admin', 'cashier'] },
  { prefix: '/dashboard', roles: ['admin', 'cashier', 'kitchen'] },
]

/**
 * Roles allowed for this pathname, or `null` if no RoleGate rule applies.
 * @param {string} pathname
 * @returns {StaffRole[] | null}
 */
export function allowedRolesForPath(pathname) {
  let best = /** @type {{ prefix: string, roles: StaffRole[] } | null} */ (null)
  for (const rule of PATH_ROLE_RULES) {
    const { prefix } = rule
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      if (!best || prefix.length > best.prefix.length) best = rule
    }
  }
  return best ? best.roles : null
}

/**
 * @param {string | undefined | null} role
 * @param {string} pathname
 */
export function roleMayAccessPath(role, pathname) {
  const allowed = allowedRolesForPath(pathname)
  if (!allowed) return true
  const r = normalizeRole(role)
  return allowed.includes(r)
}

/** @param {string | undefined | null} role */
export function normalizeRole(role) {
  const x = String(role || '').toLowerCase()
  if (x === 'admin' || x === 'cashier' || x === 'kitchen') return x
  return 'cashier'
}
