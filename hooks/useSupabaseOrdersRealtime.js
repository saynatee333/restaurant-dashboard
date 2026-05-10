'use client'

import { useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'

/** Postgres filters for `postgres_changes` — orders + line items */
const ORDERS_ITEMS_CHANGE_FILTERS = [
  { event: '*', schema: 'public', table: 'orders' },
  { event: '*', schema: 'public', table: 'order_items' },
]

/** Unique Realtime channel names per surface (avoid collisions across tabs/components). */
export const ORDERS_REALTIME_CHANNEL = {
  dashboard: 'dashboard-orders-items',
  pos: 'pos-orders-order-items',
  kitchen: 'kitchen-orders-order-items',
}

/** Sensible debounce when both tables churn (e.g. one order touch writes many `order_items`). */
export const ORDERS_REALTIME_DEBOUNCE_MS = {
  dashboard: 200,
  pos: 250,
  kitchen: 150,
}

/**
 * @param {() => void} onInvalidate Latest callback is always used (stable subscription).
 * @param {{ debounceMs?: number, channelName: string }} options
 */
export function useSupabaseOrdersRealtime(onInvalidate, options) {
  const { debounceMs = 0, channelName } = options
  const timerRef = useRef(null)
  const onInvalidateRef = useRef(onInvalidate)
  onInvalidateRef.current = onInvalidate

  useEffect(() => {
    const flush = () => {
      onInvalidateRef.current?.()
    }

    const schedule =
      debounceMs > 0
        ? () => {
            if (timerRef.current) clearTimeout(timerRef.current)
            timerRef.current = setTimeout(() => {
              timerRef.current = null
              flush()
            }, debounceMs)
          }
        : flush

    let channel = supabase.channel(channelName)
    for (const filter of ORDERS_ITEMS_CHANGE_FILTERS) {
      channel = channel.on('postgres_changes', filter, schedule)
    }

    channel.subscribe()

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      supabase.removeChannel(channel)
    }
  }, [channelName, debounceMs])
}
