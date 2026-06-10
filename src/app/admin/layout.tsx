import type { ReactNode } from 'react'
import Link from 'next/link'
import { ShieldCheck } from 'lucide-react'
import { requirePlatformAdmin } from '@/lib/auth/platform-admin'

export const dynamic = 'force-dynamic'

/**
 * Feature 031 — painel Admin-Agência (cross-tenant). Layout próprio (sem a
 * sidebar de clínica). Gateia toda a subárvore: só Admin-Agência entra; o
 * resto recebe 404 (requirePlatformAdmin → notFound).
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requirePlatformAdmin()
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <h1 className="flex items-center gap-2 text-lg font-black tracking-tight text-slate-900">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Painel Agência
          </h1>
          <Link
            href="/operacao/atendimentos"
            className="text-xs font-medium text-slate-500 hover:text-slate-800"
          >
            ← Voltar ao app
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  )
}
