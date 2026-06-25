import { supabase } from './supabase'

export async function logActivity({ action, module, description, metadata = null }) {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const { user } = session
    await supabase.from('activity_logs').insert({
      user_id: user.id,
      user_email: user.email,
      user_name: user.user_metadata?.full_name || null,
      action,
      module,
      description,
      metadata,
    })
  } catch {
    // never let logging break the main flow
  }
}
