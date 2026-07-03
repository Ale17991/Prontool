import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, ChevronLeft, Plug, Stethoscope } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { getEnabledIntegrations } from '@/lib/core/integrations/config'
import { getMemedConfigPublic } from '@/lib/core/integrations/memed/get-config-public'
import { listAdapters } from '@/lib/integrations/registry'
import type { Database } from '@/lib/db/types'

export const dynamic = 'force-dynamic'

export default async function IntegracoesListPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role !== 'admin') redirect('/configuracoes')

  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>
  const enabled = await getEnabledIntegrations(supabase, session.tenantId)
  const byProvider = new Map(enabled.map((r) => [r.provider, r]))
  const memed = await getMemedConfigPublic(supabase, session.tenantId).catch(() => null)
  const memedConnected = Boolean(memed?.connected)

  const items = listAdapters()
    .map((a) => {
      const row = byProvider.get(a.provider)
      return {
        provider: a.provider,
        label: a.label,
        description: a.description,
        connected: Boolean(row),
        connectedSince: row?.created_at ?? null,
      }
    })
    .sort((a, b) => {
      if (a.connected && !b.connected) return -1
      if (!a.connected && b.connected) return 1
      return a.label.localeCompare(b.label)
    })

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/configuracoes"
          className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800"
        >
          <ChevronLeft className="h-3 w-3" /> Voltar às configurações
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-black tracking-tight text-slate-900">
          <Plug className="h-6 w-6 text-primary" />
          Integrações
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Conecte o Clinni a plataformas externas. Uma integração por provider, ativação por
          clínica. Falhas em uma integração não afetam as demais.
        </p>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <Plug className="h-8 w-8 text-slate-300" />
            <p className="text-sm font-medium text-slate-500">Nenhum provider registrado ainda.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {items.map((it) => (
            <Link
              key={it.provider}
              href={`/configuracoes/integracoes/${it.provider}`}
              className="group flex items-start gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:border-primary/40 hover:shadow-md"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Plug className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-slate-900">{it.label}</h2>
                  {it.connected ? (
                    <Badge variant="success">Conectado</Badge>
                  ) : (
                    <Badge variant="secondary">Não configurado</Badge>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-500">{it.description}</p>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 self-center text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
            </Link>
          ))}
        </div>
      )}

      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Prescrição digital
        </h2>
        <Link
          href="/configuracoes/integracoes/memed"
          className="group flex items-start gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:border-primary/40 hover:shadow-md"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Stethoscope className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900">Memed</h2>
              {memedConnected ? (
                <Badge variant="success">
                  {memed?.environment === 'production' ? 'Produção' : 'Homologação'}
                </Badge>
              ) : (
                <Badge variant="secondary">Não configurado</Badge>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Prescrição digital de medicamentos — conecte a conta Memed da clínica.
            </p>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 self-center text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
        </Link>
      </div>
    </div>
  )
}
