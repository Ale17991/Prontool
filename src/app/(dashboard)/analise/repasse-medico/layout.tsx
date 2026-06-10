import type { ReactNode } from 'react'
import { requireFeature } from '@/lib/auth/require-entitlement'

// Feature 031 — gate de plano para Repasse Médico (inclui [mes] e por-profissional).
export default async function Layout({ children }: { children: ReactNode }) {
  await requireFeature('repasse')
  return <>{children}</>
}
