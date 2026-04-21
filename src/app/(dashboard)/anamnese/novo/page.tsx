import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/get-session'
import { can } from '@/lib/auth/rbac'
import { AnamneseBuilder } from './anamnese-builder'

export const dynamic = 'force-dynamic'

export default async function AnamneseBuilderPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!can(session.role, 'anamnesis.write')) redirect('/anamnese')

  return <AnamneseBuilder />
}
