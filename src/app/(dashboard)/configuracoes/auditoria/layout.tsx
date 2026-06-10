import type { ReactNode } from 'react'
import { requireFeature } from '@/lib/auth/require-entitlement'

// Feature 031 — gate de plano para Auditoria (Clínica).
export default async function Layout({ children }: { children: ReactNode }) {
  await requireFeature('auditoria')
  return <>{children}</>
}
