import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/get-session'

/**
 * Feature 009 (US2 + T077) — landing role-aware de /configuracoes:
 *  - admin → /configuracoes/clinica (página de maior impacto)
 *  - demais roles → /configuracoes/perfil (única página acessível por
 *    qualquer função autenticada)
 */
export const dynamic = 'force-dynamic'

export default async function ConfiguracoesPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  if (session.role === 'admin') {
    redirect('/configuracoes/clinica')
  }
  redirect('/configuracoes/perfil')
}
