import { supabase } from '@/lib/supabase'

// Sends a WhatsApp message via the `notify-whatsapp` Edge Function.
// Requires the function to be deployed and provider secrets configured
// (see supabase/functions/README.md). Throws on error.
export async function sendWhatsApp({ to, message }) {
  const { data, error } = await supabase.functions.invoke('notify-whatsapp', {
    body: { to, message },
  })
  if (error) throw error
  return data
}
