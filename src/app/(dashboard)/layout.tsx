import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { getSession } from '@/lib/auth/get-session'
import { DashboardShell } from './_components/dashboard-shell'

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/login')

  return (
    <DashboardShell role={session.role} email={session.email ?? null}>
      {children}
    </DashboardShell>
  )
}
