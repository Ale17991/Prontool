import type { ReactNode } from 'react'
import { requireModule } from '@/lib/auth/require-entitlement'

// Feature 031 — gate de módulo add-on Portal do Paciente.
export default async function Layout({ children }: { children: ReactNode }) {
  await requireModule('portal_paciente')
  return <>{children}</>
}
