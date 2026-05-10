'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import {
  fetchStaffMeFromApi,
  readAdminBranchScope,
  writeAdminBranchScope,
} from '@/lib/staffSessionClient'

/**
 * @typedef {{ role: string, branch_id: string | null, branch: { code: string | null, name: string | null } | null, email: string | null }} StaffProfile
 */

const BranchContext = createContext(null)

export function BranchProvider({ children }) {
  const [loading, setLoading] = useState(true)
  /** @type {['login' | 'error' | null, React.Dispatch<React.SetStateAction<'login' | 'error' | null>>]} */
  const [authIssue, setAuthIssue] = useState(/** @type {'login' | 'error' | null} */ (null))
  /** @type {[StaffProfile | null, React.Dispatch<React.SetStateAction<StaffProfile | null>>]} */
  const [profile, setProfile] = useState(null)
  const [branches, setBranches] = useState([])
  const [adminScope, setAdminScope] = useState(/** @type {string | null} */ (null))

  useEffect(() => {
    const stored = readAdminBranchScope()
    if (stored) setAdminScope(stored)
  }, [])

  const loadMe = useCallback(async () => {
    setLoading(true)
    setAuthIssue(null)
    try {
      const data = await fetchStaffMeFromApi()
      if (!data.ok) {
        setProfile(null)
        setBranches([])
        setAuthIssue(data.reason === 'unauthorized' ? 'login' : 'error')
      } else {
        setProfile(/** @type {StaffProfile} */ (data.profile))
        setBranches(data.branches)
        setAuthIssue(null)
      }
    } catch {
      setProfile(null)
      setBranches([])
      setAuthIssue('error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadMe()
  }, [loadMe])

  useEffect(() => {
    const supabase = getSupabaseBrowserClient()
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        void loadMe()
      }
      if (event === 'SIGNED_OUT') {
        setProfile(null)
        setBranches([])
        setAuthIssue('login')
        setLoading(false)
      }
    })
    return () => subscription.unsubscribe()
  }, [loadMe])

  const setAdminBranchScope = useCallback((id) => {
    setAdminScope(id)
    writeAdminBranchScope(id)
  }, [])

  const effectiveBranchId = useMemo(() => {
    if (!profile) return null
    if (profile.role === 'admin' && adminScope) return adminScope
    return profile.branch_id
  }, [profile, adminScope])

  const value = useMemo(
    () => ({
      loading,
      authIssue,
      profile,
      branches,
      effectiveBranchId,
      setAdminBranchScope,
      reload: loadMe,
    }),
    [loading, authIssue, profile, branches, effectiveBranchId, setAdminBranchScope, loadMe]
  )

  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>
}

export function useBranchContext() {
  const ctx = useContext(BranchContext)
  if (!ctx) {
    throw new Error('useBranchContext must be used within BranchProvider')
  }
  return ctx
}
