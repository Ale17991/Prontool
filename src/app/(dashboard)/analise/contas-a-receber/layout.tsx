import type { ReactNode } from 'react'
import { requireFeature } from '@/lib/auth/require-entitlement'

// Feature 031 — gate de plano para todo o subtree de Contas a Receber.
export default async function Layout({ children }: { children: ReactNode }) {
  await requireFeature('contas_receber')
  return <>{children}</>
}
