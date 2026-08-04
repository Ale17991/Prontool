import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { BellRing } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { can } from '@/lib/auth/rbac'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import type { Database } from '@/lib/db/types'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { implementedFamilies } from '@/lib/core/signals/catalog'
import { listRules } from '@/lib/core/signals/rules'
import { ConsentBanner } from './consent-banner'
import { RulesClient } from './rules-client'

/**
 * Feature 053 — notificações automáticas por comportamento do paciente.
 *
 * O gate de módulo está aqui E no motor (`evaluate-cycle.ts`). Esconder a tela
 * não basta: a regra ligada é estado persistido, e sem a checagem no ciclo uma
 * clínica com o módulo revogado seguiria enviando. Lição da 051.
 */

export const dynamic = 'force-dynamic'

export default async function NotificacoesAutomaticasPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!can(session.role, 'reminders.config')) redirect('/configuracoes')

  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>
  const ent = await getTenantEntitlements(supabase, session.tenantId)
  if (!ent.hasModule('acompanhamento')) redirect('/configuracoes')

  const [rules, consent] = await Promise.all([
    listRules(supabase, session.tenantId).catch(() => []),
    contagemDeAceite(supabase, session.tenantId),
  ])

  const families = implementedFamilies().map((f) => ({
    id: f.id,
    nature: f.nature,
    label: f.label,
    description: f.description,
    placeholders: [...f.placeholders],
    defaultTemplate: f.defaultTemplate,
    defaultSilenceDays: f.defaultSilenceDays,
  }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-900">
          <BellRing className="h-6 w-6 text-primary" />
          Notificações automáticas
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Mensagens que saem sozinhas a partir do que o paciente registra — ou deixa de
          registrar — entre as consultas.
        </p>
      </div>

      <ConsentBanner comAceite={consent.comAceite} ativos={consent.ativos} />

      <RulesClient initial={{ families, rules }} />
    </div>
  )
}

async function contagemDeAceite(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<{ comAceite: number; ativos: number }> {
  const ativos = await supabase
    .from('patients')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('status', 'ativo')
  const comAceite = await supabase
    .from('patients')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('status', 'ativo')
    .eq('outreach_opt_in', true)
  return { comAceite: comAceite.count ?? 0, ativos: ativos.count ?? 0 }
}
