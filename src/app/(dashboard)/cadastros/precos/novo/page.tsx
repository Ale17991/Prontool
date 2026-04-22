import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { can } from '@/lib/auth/rbac'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { NewPriceForm } from './new-price-form'

export const dynamic = 'force-dynamic'

interface ProcedureOption {
  id: string
  tuss_code: string
  display_name: string | null
}

interface PlanOption {
  id: string
  name: string
}

export default async function NovoPrecoPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!can(session.role, 'price.write')) redirect('/cadastros/precos')

  const supabase = createSupabaseServerClient()
  const [procRes, planRes] = await Promise.all([
    supabase
      .from('procedures')
      .select('id, tuss_code, display_name')
      .eq('active', true)
      .order('tuss_code'),
    supabase.from('health_plans').select('id, name').eq('active', true).order('name'),
  ])
  const procedures = (procRes.data ?? []) as ProcedureOption[]
  const plans = (planRes.data ?? []) as PlanOption[]

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href="/cadastros/precos"
          className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft className="h-3 w-3" /> Voltar para preços
        </Link>
        <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-900">
          Novo preço
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Cria a primeira versão de preço para uma combinação (procedimento, convênio).
          Valores de atendimentos existentes não são alterados — apenas novos atendimentos
          a partir da data de vigência usam o valor congelado desta versão.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Nova versão</CardTitle>
        </CardHeader>
        <CardContent>
          {procedures.length === 0 ? (
            <p className="text-sm text-slate-500">
              Cadastre ao menos um{' '}
              <Link href="/cadastros/procedimentos" className="font-semibold text-primary underline">
                procedimento
              </Link>{' '}
              antes de criar um preço.
            </p>
          ) : plans.length === 0 ? (
            <p className="text-sm text-slate-500">
              Cadastre ao menos um{' '}
              <Link href="/cadastros/planos" className="font-semibold text-primary underline">
                convênio
              </Link>{' '}
              antes de criar um preço.
            </p>
          ) : (
            <NewPriceForm procedures={procedures} plans={plans} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
