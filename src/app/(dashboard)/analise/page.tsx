import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/get-session'
import { can } from '@/lib/auth/rbac'
import { listFeatureFlags } from '@/lib/feature-flags'

export default async function AnalisePage() {
  const session = await getSession()
  if (!session) redirect('/login')
  const flags = listFeatureFlags()
  if (flags.relatorios && can(session.role, 'report.read')) redirect('/analise/relatorios')
  if (flags.comissoes && can(session.role, 'doctor.read')) redirect('/analise/comissoes')
  // Feature 014 — Auditoria mudou de casa: /analise/auditoria foi para
  // /configuracoes/auditoria. Se for o único acesso disponível em
  // Análise, mandamos direto pra nova rota canônica.
  if (can(session.role, 'audit.read')) redirect('/configuracoes/auditoria')
  redirect('/configuracoes')
}
