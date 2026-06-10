import type { ReactNode } from 'react'
import Link from 'next/link'
import { ShieldCheck } from 'lucide-react'
import { requireSuperAdmin } from '@/lib/auth/platform-admin'

export const dynamic = 'force-dynamic'

/**
 * Feature 031 — painel Admin-Agência (gestão). Só admin GERAL (is_super):
 * gerencia planos e os acessos do suporte. Usuários de suporte NÃO entram aqui
 * (acessam suas clínicas pelo seletor). Não-super recebe 404.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireSuperAdmin()
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
