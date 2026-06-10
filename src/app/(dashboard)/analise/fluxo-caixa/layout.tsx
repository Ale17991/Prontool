import type { ReactNode } from 'react'
import { requireFeature } from '@/lib/auth/require-entitlement'

// Feature 031 — gate de plano para o Fluxo de Caixa.
export default async function Layout({ children }: { children: ReactNode }) {
  await requireFeature('fluxo_caixa')
  return <>{children}</>
}
