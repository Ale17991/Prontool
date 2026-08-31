'use server'

import { headers } from 'next/headers'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import type { Database } from '@/lib/db/types'
import { revealCredentialLink, type LinkStatus } from '@/lib/core/partners/credential-link'

/**
 * Revela a credencial. É Server Action, portanto POST — e é isso que impede
 * que o pré-carregamento de link feito por cliente de e-mail e por antivírus
 * corporativo queime a credencial antes de o parceiro abrir a mensagem
 * (0215 D2).
 *
 * NÃO exige sessão de propósito: quem abre é o desenvolvedor do parceiro, que
 * não tem conta aqui. A autenticação é a posse do token de 256 bits, que só
 * existe na URL entregue e do qual guardamos apenas o hash.
 */
export async function revelarCredencialAction(
  token: string,
): Promise<{ ok: true; secret: string } | { ok: false; status: LinkStatus }> {
  const sb = createSupabaseServiceClient() as unknown as SupabaseClient<Database>
  const fwd = headers().get('x-forwarded-for')
  const ip = fwd ? (fwd.split(',')[0]?.trim() ?? null) : null

  const res = await revealCredentialLink(sb, token, ip)
  if ('secret' in res) return { ok: true, secret: res.secret }
  return { ok: false, status: res.erro }
}
