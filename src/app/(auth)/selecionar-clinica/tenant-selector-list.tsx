'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, CheckCircle2, Stethoscope } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/db/supabase-browser'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { AvailableTenant } from '@/lib/auth/available-tenants'

interface TenantSelectorListProps {
  tenants: AvailableTenant[]
  currentTenantId: string | null
}

/**
 * Feature 010 (US3) — grid de cards para usuários multi-tenant escolherem
 * a clínica ativa. Clique → POST /api/auth/switch-tenant + refreshSession +
 * redirect /operacao/atendimentos (R5).
 */
export function TenantSelectorList({ tenants, currentTenantId }: TenantSelectorListProps) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Ordena: clínica atual primeiro; depois por última usada; depois por nome.
  const sortedTenants = [...tenants].sort((a, b) => {
    if (a.tenantId === currentTenantId) return -1
    if (b.tenantId === currentTenantId) return 1
    if (a.lastUsedAt && b.lastUsedAt) return b.lastUsedAt.localeCompare(a.lastUsedAt)
    if (a.lastUsedAt) return -1
    if (b.lastUsedAt) return 1
    return a.name.localeCompare(b.name)
  })

  async function selectTenant(tenantId: string) {
    setBusyId(tenantId)
    setError(null)
    try {
      const res = await fetch('/api/auth/switch-tenant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        throw new Error(body?.error?.message ?? 'Não foi possível trocar de clínica.')
      }
      const supabase = createSupabaseBrowserClient()
      await supabase.auth.refreshSession()
      router.push('/operacao/atendimentos')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao trocar de clínica.')
      setBusyId(null)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6 font-sans">
      <div className="w-full max-w-3xl space-y-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary shadow-lg shadow-primary/20">
            <Stethoscope className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight text-slate-900">
              Selecionar clínica
            </h1>
            <p className="text-xs text-slate-500">
              Você está vinculado a {tenants.length} clínicas. Escolha em qual quer
              trabalhar agora.
            </p>
          </div>
        </div>

        {error ? (
          <p className="rounded-md border border-rose-100 bg-rose-50 p-3 text-xs font-medium text-rose-700">
            {error}
          </p>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {sortedTenants.map((t) => {
            const isCurrent = t.tenantId === currentTenantId
            const isBusy = busyId === t.tenantId
            return (
              <button
                key={t.tenantId}
                type="button"
                onClick={() => selectTenant(t.tenantId)}
                disabled={busyId !== null}
                className={
                  'relative flex flex-col items-start gap-3 rounded-2xl border bg-white p-5 text-left shadow-sm transition-all hover:shadow-md disabled:opacity-50 ' +
                  (isCurrent
                    ? 'border-primary ring-2 ring-primary/30'
                    : 'border-slate-200 hover:border-primary/40')
                }
              >
                {isCurrent ? (
                  <div className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-primary">
                    <CheckCircle2 className="h-3 w-3" /> Atual
                  </div>
                ) : null}

                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
                  <Building2 className="h-5 w-5" />
                </div>
                <div className="w-full space-y-1">
                  <h2 className="truncate text-base font-bold text-slate-900">
                    {t.name}
                  </h2>
                  <p className="truncate text-[11px] font-mono text-slate-500">
                    {t.slug}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{labelForRole(t.role)}</Badge>
                  {t.ghlConnected ? (
                    <Badge variant="success">GHL conectado</Badge>
                  ) : null}
                </div>
                {t.lastUsedAt ? (
                  <p className="text-[10px] text-slate-400">
                    Última visita:{' '}
                    {new Date(t.lastUsedAt).toLocaleString('pt-BR', {
                      timeZone: 'America/Sao_Paulo',
                    })}
                  </p>
                ) : null}
                {isBusy ? (
                  <p className="text-[11px] font-medium text-primary">
                    Selecionando…
                  </p>
                ) : null}
              </button>
            )
          })}
        </div>

        <Button asChild variant="ghost" className="w-full sm:w-auto">
          <a href="/login">Sair</a>
        </Button>
      </div>
    </main>
  )
}

function labelForRole(role: string): string {
  switch (role) {
    case 'admin':
      return 'Administrador'
    case 'financeiro':
      return 'Financeiro'
    case 'recepcionista':
      return 'Recepção'
    case 'profissional_saude':
      return 'Profissional de Saúde'
    default:
      return role
  }
}
