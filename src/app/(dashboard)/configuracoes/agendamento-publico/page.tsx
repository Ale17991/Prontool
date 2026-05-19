import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CalendarPlus } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { can } from '@/lib/auth/rbac'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import type { Database } from '@/lib/db/types'
import { getPublicBookingConfig } from '@/lib/core/public-booking/config'
import { PublicBookingForm } from './public-booking-form'

export const dynamic = 'force-dynamic'

interface DoctorOption {
  id: string
  fullName: string
}

interface ProcedureOption {
  id: string
  name: string
}

export default async function AgendamentoPublicoPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!can(session.role, 'public_booking.config')) redirect('/configuracoes')

  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>

  const [config, doctorsRes, proceduresRes] = await Promise.all([
    getPublicBookingConfig(supabase, session.tenantId),
    supabase
      .from('doctors')
      .select('id, full_name, active')
      .eq('tenant_id', session.tenantId)
      .eq('active', true)
      .order('full_name'),
    supabase
      .from('procedures')
      .select('id, display_name, tuss_code, active')
      .eq('tenant_id', session.tenantId)
      .eq('active', true)
      .is('deleted_at', null)
      .order('display_name'),
  ])

  const allDoctors: DoctorOption[] = (doctorsRes.data ?? []).map((d) => ({
    id: d.id,
    fullName: d.full_name,
  }))

  const allProcedures: ProcedureOption[] = (proceduresRes.data ?? []).map((p) => ({
    id: p.id,
    name: p.display_name ?? p.tuss_code ?? '—',
  }))

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? 'http://localhost:3000'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-900">
          <CalendarPlus className="h-6 w-6 text-primary" />
          Agendamento online
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Link público para pacientes agendarem consulta sem login. Disponível em{' '}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
            {baseUrl}/agendar/[slug]
          </code>
          .
        </p>
      </div>

      <PublicBookingForm
        initial={config}
        allDoctors={allDoctors}
        allProcedures={allProcedures}
        baseUrl={baseUrl}
      />
    </div>
  )
}
