import type { ReactNode } from 'react'
import { requireModule } from '@/lib/auth/require-entitlement'

// Feature 031 — gate de módulo Faturamento TISS.
export default async function Layout({ children }: { children: ReactNode }) {
  await requireModule('tiss')
  return <>{children}</>
}
