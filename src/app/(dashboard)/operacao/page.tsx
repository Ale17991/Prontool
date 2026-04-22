import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/get-session'
import { can } from '@/lib/auth/rbac'

export default async function OperacaoPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (can(session.role, 'appointment.read')) redirect('/operacao/atendimentos')
  if (can(session.role, 'alert.read')) redirect('/operacao/alertas')
  if (can(session.role, 'dlq.read')) redirect('/operacao/dlq')
  redirect('/configuracoes')
}
