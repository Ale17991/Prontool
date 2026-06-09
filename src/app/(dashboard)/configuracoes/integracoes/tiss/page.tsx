import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft, FileText } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import type { Database } from '@/lib/db/types'
import { TissCertificateForm } from './tiss-certificate-form'
import { TissOperatorForm } from './tiss-operator-form'

/**
 * Feature 029 (US1) — configuração do faturamento TISS. Admin habilita cada
 * convênio (Registro ANS, código do contratado, CNPJ/CNES) e sobe o certificado
 * ICP-Brasil A1. Nenhum segredo é renderizado — só metadados (CN/validade).
 */
export const dynamic = 'force-dynamic'

export default async function TissIntegrationPage(): Promise<JSX.Element> {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role !== 'admin') redirect('/configuracoes')

  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>

  const [{ data: plans }, { data: configs }, { data: cert }] = await Promise.all([
    supabase.from('health_plans').select('id, name').eq('active', true).order('name'),
    supabase
      .from('tenant_tiss_operator_config')
      .select('health_plan_id, ans_registration, contracted_code, contracted_cnpj, contracted_cnes, active'),
    supabase
      .from('tenant_tiss_certificates')
      .select('id, subject_cn, not_after')
      .eq('active', true)
      .maybeSingle(),
  ])

  const configByPlan = new Map((configs ?? []).map((c) => [c.health_plan_id, c]))

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/configuracoes/integracoes"
          className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800"
        >
          <ChevronLeft className="h-3 w-3" /> Voltar às integrações
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-black tracking-tight text-slate-900">
          <FileText className="h-6 w-6 text-primary" />
          Faturamento TISS de convênios
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Habilite cada convênio com os dados do contratado na operadora e suba o certificado
          ICP-Brasil A1 usado para assinar os lotes. Versão do padrão: 04.03.00.
        </p>
      </div>

      <TissCertificateForm initialCertificate={cert ?? null} />

      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Convênios</h2>
        {(plans ?? []).length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-6 text-sm text-slate-500">
            Nenhum convênio ativo. Cadastre convênios em Configurações para habilitar o TISS.
          </p>
        ) : (
          (plans ?? []).map((plan) => (
            <TissOperatorForm
              key={plan.id}
              planId={plan.id}
              planName={plan.name}
              initialConfig={configByPlan.get(plan.id) ?? null}
            />
          ))
        )}
      </section>
    </div>
  )
}
