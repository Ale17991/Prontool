import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/get-session'
import { can } from '@/lib/auth/rbac'

export default async function CadastrosPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (can(session.role, 'procedure.read')) redirect('/cadastros/procedimentos')
  if (can(session.role, 'plan.read')) redirect('/cadastros/planos')
  if (can(session.role, 'doctor.read')) redirect('/cadastros/profissionais')
  redirect('/configuracoes')
}
