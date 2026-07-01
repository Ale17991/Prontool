// @ts-nocheck
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
const sb: any = createSupabaseServiceClient()
async function main() {
  const a = await sb.from('user_integrations').select('user_id', { count: 'exact', head: true })
  const b = await sb
    .from('appointment_calendar_sync')
    .select('appointment_id', { count: 'exact', head: true })
  console.log(
    'user_integrations (0124):',
    a.error ? `AUSENTE — ${a.error.message.slice(0, 50)}` : 'OK',
  )
  console.log(
    'appointment_calendar_sync (0124):',
    b.error ? `AUSENTE — ${b.error.message.slice(0, 50)}` : 'OK',
  )
}
main().catch((e) => console.error('FATAL', e.message))
