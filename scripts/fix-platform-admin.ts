// @ts-nocheck
/** (Re)insere um usuário como super-admin de plataforma (acesso ao /admin). */
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'

const EMAIL = process.argv[2] ?? 'operations@homio.com.br'
const sb: any = createSupabaseServiceClient()

async function main() {
  const users = await sb.auth.admin.listUsers({ page: 1, perPage: 200 })
  const u = users.data?.users.find((x: any) => x.email === EMAIL)
  if (!u) throw new Error(`usuário ${EMAIL} não encontrado`)
  const r = await sb
    .from('platform_admins')
    .upsert({ user_id: u.id, is_super: true }, { onConflict: 'user_id' })
  if (r.error) throw new Error(`upsert falhou: ${r.error.message}`)
  console.log(`✅ ${EMAIL} (${u.id}) agora é super-admin de plataforma.`)
  const all = await sb.from('platform_admins').select('user_id, is_super')
  console.log(`total platform_admins: ${all.data?.length ?? 0}`)
  for (const row of all.data ?? []) console.log(`  - ${row.user_id} is_super=${row.is_super}`)
}

main().catch((e) => {
  console.error('FATAL', e.message)
  process.exit(1)
})
