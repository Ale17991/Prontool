import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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

  const [plansRes, doctorsRes, liberalsRes, proceduresRes] = await Promise.all([
    supabase
      .from('health_plans')
      .select('id, name')
      .eq('active', true)
      .order('name', { ascending: true }),
    // Doctors elegíveis para "Profissional principal" — Liberais NÃO aparecem
    // (Decisão 5: Liberal cobra como assistente, não como principal).
    supabase
      .from('doctors')
      .select('id, full_name, payment_mode')
      .eq('active', true)
      .in('payment_mode', ['comissionado', 'fixo'])
      .order('full_name', { ascending: true }),
    // Doctors elegíveis como assistentes (apenas Liberais).
    supabase
      .from('doctors')
      .select(
        'id, full_name, doctor_payment_terms_current:id ( liberal_default_cents )',
      )
      .eq('active', true)
      .eq('payment_mode', 'liberal')
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

  const plans: FormOption[] = ((plansRes.data ?? []) as Array<{ id: string; name: string }>).map(
    (p) => ({ id: p.id, label: p.name }),
  )
  const doctors: FormOption[] = (
    (doctorsRes.data ?? []) as Array<{ id: string; full_name: string }>
  ).map((d) => ({ id: d.id, label: d.full_name }))

  // Liberais: lookup separado para liberal_default_cents (embed via FK foi
  // confuso por tipagem; query direta é mais limpa).
  let liberalDoctors: Array<{ id: string; fullName: string; defaultAmountCents: number }> = []
  const liberalRows = (liberalsRes.data ?? []) as Array<{
    id: string
    full_name: string
  }>
  if (liberalRows.length > 0) {
    const ids = liberalRows.map((l) => l.id)
    const { data: termsRows } = await supabase
      .from('doctor_payment_terms_current' as never)
      .select('doctor_id, liberal_default_cents')
      .in('doctor_id', ids)
    const defaults = new Map<string, number>()
    for (const r of (termsRows ?? []) as Array<{
      doctor_id: string
      liberal_default_cents: number | null
    }>) {
      if (r.liberal_default_cents !== null) {
        defaults.set(r.doctor_id, r.liberal_default_cents)
      }
    }
    liberalDoctors = liberalRows.map((l) => ({
      id: l.id,
      fullName: l.full_name,
      defaultAmountCents: defaults.get(l.id) ?? 0,
    }))
  }
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
            liberalDoctors={liberalDoctors}
            procedures={procedures}
            plans={plans}
            initialAppointmentAt={searchParams.at}
          />
        </CardContent>
      </Card>
    </div>
  )
}
