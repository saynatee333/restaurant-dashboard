import { supabase } from '@/lib/supabase'

export async function kitchenMarkItemPreparing(itemId, orderId) {
  await supabase.from('order_items').update({ status: 'firing' }).eq('id', itemId)
  if (orderId != null) {
    await supabase.rpc('pos_transition_order_status', {
      p_order_id: orderId,
      p_next_status: 'in_progress',
    })
  }
}

export async function kitchenMarkItemDone(itemId) {
  await supabase.rpc('pos_mark_item_done', { p_order_item_id: itemId })
}
