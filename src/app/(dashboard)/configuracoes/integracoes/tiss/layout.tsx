import type { ReactNode } from 'react'
import { requireModule } from '@/lib/auth/require-entitlement'

// Feature 031/042 — gate de módulo: TISS faz parte do módulo Convênio.
export default async function Layout({ children }: { children: ReactNode }) {
  await requireModule('convenio')
  return <>{children}</>
}
