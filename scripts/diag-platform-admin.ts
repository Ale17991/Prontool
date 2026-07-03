#!/usr/bin/env tsx
// @ts-nocheck — diagnóstico pontual.
/** Checa se um usuário é super-admin de plataforma (guard do /admin). */
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'

const EMAIL = process.argv[2] ?? 'operations@homio.com.br'
const sb: any = createSupabaseServiceClient()

async function main() {
  const users = await sb.auth.admin.listUsers({ page: 1, perPage: 200 })
  const u = users.data?.users.find((x: any) => x.email === EMAIL)
  if (!u) {
    console.log(`❌ usuário ${EMAIL} não encontrado em auth.users`)
    return
  }
  console.log(`user: ${EMAIL}  id=${u.id}`)

  // A coluna is_super existe? (0119)
  const pa = await sb
    .from('platform_admins')
    .select('user_id, is_super')
    .eq('user_id', u.id)
    .maybeSingle()
  if (pa.error) {
    console.log(`❌ query platform_admins falhou: ${pa.error.message}`)
    console.log('   → se menciona "is_super", a migration 0119 NÃO está aplicada em produção.')
    return
  }
  if (!pa.data) {
    console.log('❌ NÃO está em platform_admins → guard /admin retorna 404 (notFound).')
    console.log(
      '   → inserir: INSERT INTO platform_admins (user_id, is_super) VALUES (<id>, true);',
    )
    return
  }
  console.log(`platform_admins: presente. is_super = ${pa.data.is_super}`)
  console.log(
    pa.data.is_super === true
      ? '✅ é super-admin — /admin deveria abrir. Se ainda 404, é sessão/token (deslogar e logar).'
      : '⚠️ is_super=false (suporte) → NÃO acessa /admin (gestão). Precisa is_super=true.',
  )

  // Conta total de platform_admins (sanity).
  const all = await sb.from('platform_admins').select('user_id, is_super')
  console.log(`total platform_admins: ${all.data?.length ?? 0}`)
  for (const r of all.data ?? []) console.log(`  - ${r.user_id} is_super=${r.is_super}`)
}

main().catch((e) => {
  console.error('FATAL', e.message)
  process.exit(1)
})
