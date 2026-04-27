import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { Card, CardContent } from '@/components/ui/card'
import { getEnabledIntegrations } from '@/lib/core/integrations/config'
import type { Database } from '@/lib/db/types'
import {
  NewPatientPageClient,
  type AnamnesisTemplateOption,
  type HealthPlanOption,
} from './new-patient-page-client'

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = new Set(['admin', 'recepcionista'])

interface TemplateRow {
  id: string
  title: string
  description: string | null
  version: number
  fields: unknown
  active: boolean
}

export default async function NovoPacientePage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!ALLOWED_ROLES.has(session.role)) redirect('/operacao/pacientes')

  const supabase = createSupabaseServerClient()
  const [plansRes, templatesRes] = await Promise.all([
    supabase
      .from('health_plans')
      .select('id, name')
      .eq('active', true)
      .order('name', { ascending: true }),
    supabase
      .from('anamnesis_templates')
      .select('id, title, description, version, fields, active')
      .eq('tenant_id', session.tenantId)
      .eq('active', true)
      .order('title', { ascending: true })
      .order('version', { ascending: false }),
  ])

  const healthPlans: HealthPlanOption[] = (
    (plansRes.data ?? []) as Array<{ id: string; name: string }>
  ).map((p) => ({ id: p.id, name: p.name }))

  // Dedupe por title — só a versão mais recente. Como o select já vem
  // ordered (title asc, version desc), o primeiro de cada title é a v
  // mais recente.
  const seenTitle = new Set<string>()
  const templates: AnamnesisTemplateOption[] = []
  for (const t of (templatesRes.data ?? []) as TemplateRow[]) {
    if (seenTitle.has(t.title)) continue
    if (!Array.isArray(t.fields) || t.fields.length === 0) continue
    seenTitle.add(t.title)
    templates.push({
      id: t.id,
      title: t.title,
      description: t.description,
      version: t.version,
      fields: t.fields as AnamnesisTemplateOption['fields'],
    })
  }

  const rls = supabase as unknown as SupabaseClient<Database>
  const integrations = await getEnabledIntegrations(rls, session.tenantId)
  const hasIntegrations = integrations.length > 0

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/operacao/pacientes"
          className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800"
        >
          <ChevronLeft className="h-3 w-3" /> Voltar aos pacientes
        </Link>
        <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-900">
          Novo paciente
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {hasIntegrations
            ? 'PII criptografada localmente. O contato é mirrorado para as integrações ativas em melhor-esforço — se alguma estiver indisponível, o paciente é salvo mesmo assim e um alerta operacional é aberto.'
            : 'PII criptografada localmente.'}
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <NewPatientPageClient
            healthPlans={healthPlans}
            templates={templates}
          />
        </CardContent>
      </Card>
    </div>
  )
}
