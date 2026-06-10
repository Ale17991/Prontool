import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { HeartPulse } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { can } from '@/lib/auth/rbac'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { resolvePublicBaseUrl } from '@/lib/core/app-url'
import type { Database } from '@/lib/db/types'
import {
  getPatientPortalConfig,
  listMetricSettings,
} from '@/lib/core/patient-portal/portal-config'
import { resolvePortalSections } from '@/lib/core/patient-portal/sections'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { PortalConfigForm } from './portal-config-form'
import { PortalSectionsForm } from './portal-sections-form'

export const dynamic = 'force-dynamic'

export default async function PortalPacientePage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!can(session.role, 'patient_portal.config')) redirect('/configuracoes')

  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>

  const ent = await getTenantEntitlements(supabase, session.tenantId)
  const [config, metrics, sections] = await Promise.all([
    getPatientPortalConfig(supabase, session.tenantId),
    listMetricSettings(supabase, session.tenantId, { specialty: 'endocrino' }),
    resolvePortalSections(supabase, session.tenantId, { hasModule: (m) => ent.hasModule(m) }),
  ])

  const baseUrl = resolvePublicBaseUrl()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-900">
          <HeartPulse className="h-6 w-6 text-primary" />
          Portal do paciente
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Área onde o paciente entra com CPF e data de nascimento para acompanhar sua
          evolução (peso, IMC e métricas metabólicas) e seus atendimentos. Disponível em{' '}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
            {baseUrl}/paciente/[endereço]
          </code>
          .
        </p>
      </div>

      <PortalConfigForm initialConfig={config} initialMetrics={metrics} baseUrl={baseUrl} />
      <PortalSectionsForm initialSections={sections} />
    </div>
  )
}
