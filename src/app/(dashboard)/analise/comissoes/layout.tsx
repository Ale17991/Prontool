import type { ReactNode } from 'react'
import { requireFeature } from '@/lib/auth/require-entitlement'

// Feature 031 — gate de plano para Comissões.
export default async function Layout({ children }: { children: ReactNode }) {
  await requireFeature('comissoes')
  return <>{children}</>
}
