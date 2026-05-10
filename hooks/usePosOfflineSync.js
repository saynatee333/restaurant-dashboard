'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { readPosOfflineQueue } from '@/lib/offline/posOfflineStorage'
import { runPosOfflineSync } from '@/lib/offline/posSyncService'

export function usePosOfflineSync() {
  const online = useOnlineStatus()
  const [syncing, setSyncing] = useState(false)
  const [lastResult, setLastResult] = useState(null)
  const [pendingCount, setPendingCount] = useState(0)

  const refreshQueueCount = useCallback(() => {
    setPendingCount(readPosOfflineQueue().length)
  }, [])

  const syncNow = useCallback(async () => {
    if (!online) return null
    setSyncing(true)
    try {
      const result = await runPosOfflineSync()
      setLastResult(result)
      return result
    } finally {
      setSyncing(false)
      refreshQueueCount()
    }
  }, [online, refreshQueueCount])

  useEffect(() => {
    refreshQueueCount()
  }, [refreshQueueCount])

  useEffect(() => {
    if (!online) return
    if (readPosOfflineQueue().length === 0) return
    void syncNow()
  }, [online, syncNow])

  return useMemo(
    () => ({ online, syncing, lastResult, pendingCount, refreshQueueCount, syncNow }),
    [online, syncing, lastResult, pendingCount, refreshQueueCount, syncNow]
  )
}
