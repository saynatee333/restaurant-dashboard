'use client'

import { useEffect, useRef } from 'react'
import { trackOperationalEvent } from '@/lib/ops/monitoringClient'

/**
 * Notify kitchen when pending queue increases.
 * @param {Array<Record<string, unknown>>} pendingRows
 */
export function useKitchenNewOrderNotification(pendingRows) {
  const prevCountRef = useRef(0)
  const initializedRef = useRef(false)

  useEffect(() => {
    const count = Array.isArray(pendingRows) ? pendingRows.length : 0
    if (!initializedRef.current) {
      initializedRef.current = true
      prevCountRef.current = count
      return
    }

    if (count > prevCountRef.current) {
      const delta = count - prevCountRef.current
      trackOperationalEvent('kitchen_new_order_detected', { pending: count, delta })

      if (typeof window !== 'undefined' && 'Notification' in window) {
        if (Notification.permission === 'granted') {
          new Notification('มีออเดอร์ใหม่เข้าครัว', {
            body: `มีรายการใหม่ ${delta} รายการ`,
            tag: 'kitchen-new-order',
          })
        } else if (Notification.permission === 'default') {
          void Notification.requestPermission()
        }
      }
    }

    prevCountRef.current = count
  }, [pendingRows])
}
