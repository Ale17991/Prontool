import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { getSession } from '@/lib/auth/get-session'
import { can } from '@/lib/auth/rbac'

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/login')

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', minHeight: '100vh' }}>
      <aside style={{ background: '#0f172a', color: 'white', padding: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 24 }}>Homio Faturamento</div>
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 16 }}>
          {session.email} · {session.role}
        </div>
        <nav style={{ display: 'grid', gap: 4 }}>
          {can(session.role, 'appointment.read') && (
            <NavLink href="/atendimentos" label="Atendimentos" />
          )}
          {can(session.role, 'price.read') && (
            <NavLink href="/precos" label="Preços" />
          )}
          {can(session.role, 'procedure.read') && (
            <NavLink href="/procedimentos" label="Procedimentos" />
          )}
          {can(session.role, 'plan.read') && (
            <NavLink href="/planos" label="Planos" />
          )}
          {can(session.role, 'doctor.read') && (
            <NavLink href="/medicos" label="Médicos" />
          )}
          {can(session.role, 'report.read') && (
            <NavLink href="/relatorios/mensal" label="Relatório mensal" />
          )}
          {can(session.role, 'alert.read') && (
            <NavLink href="/alertas" label="Alertas" />
          )}
          {can(session.role, 'dlq.read') && <NavLink href="/dlq" label="DLQ" />}
          {can(session.role, 'audit.read') && (
            <NavLink href="/auditoria" label="Auditoria" />
          )}
        </nav>
      </aside>
      <main style={{ padding: 24 }}>{children}</main>
    </div>
  )
}

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} style={{ color: '#e2e8f0', padding: '6px 8px', borderRadius: 4 }}>
      {label}
    </Link>
  )
}
