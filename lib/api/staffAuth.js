import { normalizeRole } from '@/lib/roles'

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function getAuthenticatedUserOrNull(supabase) {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) return null
  return user
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 */
export async function getStaffRole(supabase, userId) {
  const pr = await supabase
    .from('staff_profiles')
    .select('role')
    .eq('user_id', userId)
    .maybeSingle()

  return normalizeRole(pr.data?.role ?? 'cashier')
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 */
export async function getStaffProfileRow(supabase, userId) {
  return supabase
    .from('staff_profiles')
    .select('role, branch_id, branches(code,name)')
    .eq('user_id', userId)
    .maybeSingle()
}
