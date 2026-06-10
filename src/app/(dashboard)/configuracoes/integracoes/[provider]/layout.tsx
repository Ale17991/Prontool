import type { ReactNode } from 'react'
import { requireModule } from '@/lib/auth/require-entitlement'

// Feature 031 — gate de módulo CRM para a config de provedores de integração.
export default async function Layout({ children }: { children: ReactNode }) {
  await requireModule('crm')
  return <>{children}</>
}
