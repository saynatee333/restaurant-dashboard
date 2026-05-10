'use client'

import { useEffect, useState } from 'react'
import { trackOperationalEvent } from '@/lib/ops/monitoringClient'
import { supabase } from '@/lib/supabase'

/**
 * Subscribe payment-failure events for admin operations.
 */
export function useAdminPaymentFailureNotification() {
  const [lastFailure, setLastFailure] = useState(null)

  useEffect(() => {
    const onFailure = (payload) => {
      const record = payload?.new
      const reason = record?.payload?.reason || record?.action || 'payment_failed'
      const entityId = record?.entity_id || '-'
      const msg = `Payment failure: ${reason} (entity ${entityId})`
      setLastFailure({ message: msg, at: new Date().toISOString() })
      trackOperationalEvent('admin_payment_failure_notified', { reason, entityId })

      if (typeof window !== 'undefined' && 'Notification' in window) {
        if (Notification.permission === 'granted') {
          new Notification('แจ้งเตือน Payment Failure', {
            body: msg,
            tag: 'admin-payment-failure',
          })
        } else if (Notification.permission === 'default') {
          void Notification.requestPermission()
        }
      }
    }

    const channel = supabase
      .channel('admin-payment-failure-alerts')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'audit_logs',
          filter: 'action=eq.payment_fail',
        },
        onFailure
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'audit_logs',
          filter: 'action=eq.payment_callback_failed',
        },
        onFailure
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  return { lastFailure, clearFailure: () => setLastFailure(null) }
}
