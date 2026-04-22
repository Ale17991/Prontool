import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/get-session'
import { can } from '@/lib/auth/rbac'
import { listFeatureFlags } from '@/lib/feature-flags'

export default async function AnalisePage() {
  const session = await getSession()
  if (!session) redirect('/login')
  const flags = listFeatureFlags()
  if (flags.relatorios && can(session.role, 'report.read')) redirect('/analise/relatorios/mensal')
  if (flags.comissoes && can(session.role, 'doctor.read')) redirect('/analise/comissoes')
  if (flags.despesas && session.role === 'admin') redirect('/analise/despesas')
  if (flags.anamnese && session.role === 'admin') redirect('/analise/anamnese')
  if (can(session.role, 'audit.read')) redirect('/analise/auditoria')
  redirect('/configuracoes')
}
