import { redirect } from 'next/navigation'
import { Users, Lock, Unlock } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getMonthlyPayoutSnapshot } from '@/lib/core/monthly-payouts'
import type { Database } from '@/lib/db/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatCurrency } from '@/lib/utils'
import { PayoutsView } from './payouts-view'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: { mes: string }
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

export default async function RepasseMesPage({ params }: PageProps) {
  if (!MONTH_RE.test(params.mes)) {
    redirect('/analise/repasse-medico')
  }
  const session = await getSession()
  if (!session) redirect('/login')
  if (
    session.role !== 'admin' &&
    session.role !== 'financeiro' &&
    session.role !== 'profissional_saude'
  ) {
    redirect('/operacao/atendimentos')
  }

  let restrictDoctorId: string | null = null
  if (session.role === 'profissional_saude') {
    const sb = createSupabaseServiceClient()
    const doctorRes = await sb
      .from('doctors')
      .select('id')
      .eq('tenant_id', session.tenantId)
      .eq('user_id', session.userId)
      .maybeSingle()
    if (doctorRes.data) {
      restrictDoctorId = (doctorRes.data as { id: string }).id
    }
  }

  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>
  const snapshot = await getMonthlyPayoutSnapshot(supabase, {
    tenantId: session.tenantId,
    month: params.mes,
    restrictDoctorId,
  })

  const canManage = session.role === 'admin'

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">
            Repasse Médico — {params.mes}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {session.role === 'profissional_saude'
              ? 'Detalhe do seu repasse no mês.'
              : 'Snapshot mensal por médico com comissões, ajustes e pagamentos.'}
          </p>
        </div>
        <Badge
          variant="secondary"
          className={
            snapshot.isClosed
              ? 'h-6 gap-1 bg-success-bg px-2 text-success-text'
              : 'h-6 gap-1 bg-info-bg px-2 text-info-text'
          }
        >
          {snapshot.isClosed ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
          {snapshot.isClosed ? 'Fechado' : 'Aberto'}
        </Badge>
      </div>

      <Card>
        <CardContent className="p-5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Total devido no mês
          </p>
          <p className="text-2xl font-black tracking-tight text-slate-900">
            {formatCurrency(snapshot.totalDueCents)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {snapshot.payouts.length} médico(s)
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Users className="h-4 w-4 text-primary" />
            Repasses
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PayoutsView
            month={params.mes}
            snapshot={snapshot}
            canCloseMonth={canManage && !snapshot.isClosed}
            canReopenMonth={canManage && snapshot.isClosed && snapshot.canReopen}
            canReopenReason={snapshot.canReopenReason}
            canMarkPaid={
              session.role === 'admin' || session.role === 'financeiro'
            }
            isOwnViewOnly={session.role === 'profissional_saude'}
          />
        </CardContent>
      </Card>
    </div>
  )
}
