import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import type { Database } from '@/lib/db/types'
import { NewAppointmentForm, type FormOption } from './new-appointment-form'

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = new Set(['admin', 'recepcionista'])

interface PageProps {
  searchParams: { at?: string }
}

export default async function NovoAtendimentoPage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!ALLOWED_ROLES.has(session.role)) redirect('/operacao/atendimentos')

  const supabase = createSupabaseServerClient()

  const [plansRes, doctorsRes, proceduresRes] = await Promise.all([
    supabase
      .from('health_plans')
      .select('id, name')
      .eq('active', true)
      .order('name', { ascending: true }),
    // Profissional principal do atendimento. Participantes adicionais (equipe,
    // qualquer modalidade) são cadastrados depois na tela do atendimento.
    supabase
      .from('doctors')
      .select('id, full_name, payment_mode')
      .eq('active', true)
      .in('payment_mode', ['comissionado', 'fixo'])
      .order('full_name', { ascending: true }),
    supabase
      .from('procedures')
      .select(
        'id, tuss_code, display_name, covered_by_plan, default_amount_cents, is_unlisted, custom_code_id, ' +
          'custom_procedure_codes:custom_code_id(code, description)',
      )
      .eq('active', true)
      .is('deleted_at', null)
      .order('tuss_code', { ascending: true }),
  ])

  // Participantes (equipe): qualquer profissional ativo + graus do domínio 35.
  const [participantDoctorsRes, degreesRes] = await Promise.all([
    supabase
      .from('doctors')
      .select('id, full_name')
      .eq('active', true)
      .order('full_name', { ascending: true }),
    supabase
      .from('tiss_domain_tables')
      .select('code, description, valid_to')
      .eq('domain_number', '35')
      .order('code', { ascending: true }),
  ])
  const participantDoctors = (
    (participantDoctorsRes.data ?? []) as Array<{ id: string; full_name: string }>
  ).map((d) => ({ id: d.id, fullName: d.full_name }))
  const todayYmd = new Date().toISOString().slice(0, 10)
  const degreeOptions = (
    (degreesRes.data ?? []) as Array<{ code: string; description: string; valid_to: string | null }>
  )
    .filter((r) => r.valid_to === null || r.valid_to >= todayYmd)
    .map((r) => ({ code: r.code, label: r.description }))

  // Intervalo da agenda (config da clínica) — preenche o fim automaticamente.
  let slotIntervalMinutes = 30
  {
    const { data: profileRow } = await supabase
      .from('tenant_clinic_profile')
      .select('calendar_slot_interval_minutes')
      .maybeSingle()
    const v = (profileRow as { calendar_slot_interval_minutes?: number | null } | null)
      ?.calendar_slot_interval_minutes
    if (typeof v === 'number' && v >= 1) slotIntervalMinutes = v
  }

  // Módulo Convênio: off ⇒ atendimento é só particular (sem planos de convênio).
  const ent = await getTenantEntitlements(
    supabase as unknown as SupabaseClient<Database>,
    session.tenantId,
  )
  const hasConvenio = ent.hasModule('convenio')

  const plans: FormOption[] = hasConvenio
    ? ((plansRes.data ?? []) as Array<{ id: string; name: string }>).map((p) => ({
        id: p.id,
        label: p.name,
      }))
    : []
  const doctors: FormOption[] = (
    (doctorsRes.data ?? []) as Array<{ id: string; full_name: string }>
  ).map((d) => ({ id: d.id, label: d.full_name }))

  const procedures = (
    (proceduresRes.data ?? []) as Array<{
      id: string
      tuss_code: string | null
      display_name: string | null
      covered_by_plan: boolean | null
      default_amount_cents: number | null
      is_unlisted: boolean | null
      custom_code_id: string | null
      custom_procedure_codes: { code: string; description: string } | null
    }>
  ).map((p) => {
    const isUnlisted = p.is_unlisted === true
    const customCode = p.custom_procedure_codes?.code ?? null
    // Codigo a exibir: TUSS para listados, codigo personalizado para
    // unlisted-com-custom, "(não listado)" para unlisted-sem-codigo.
    const codeLabel = customCode ?? p.tuss_code ?? '(não listado)'
    return {
      id: p.id,
      tussCode: codeLabel,
      displayName: p.display_name,
      coveredByPlan: p.covered_by_plan ?? true,
      defaultAmountCents: p.default_amount_cents,
      isUnlisted,
      isCustomCoded: customCode !== null,
    }
  })
  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="outline" size="sm" className="h-8 gap-1.5">
          <Link href="/operacao/atendimentos">
            <ArrowLeft className="h-3.5 w-3.5" />
            Voltar
          </Link>
        </Button>
        <h1 className="mt-3 text-2xl font-black tracking-tight text-slate-900">
          Novo atendimento
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Registre um atendimento realizado manualmente. Valor preenchido automaticamente com
          base na tabela de preços vigente; edite se for necessário.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Dados do atendimento</CardTitle>
        </CardHeader>
        <CardContent>
          <NewAppointmentForm
            doctors={doctors}
            procedures={procedures}
            plans={plans}
            hasConvenio={hasConvenio}
            participantDoctors={participantDoctors}
            participationDegrees={degreeOptions}
            slotIntervalMinutes={slotIntervalMinutes}
            initialAppointmentAt={searchParams.at}
          />
        </CardContent>
      </Card>
    </div>
  )
}
