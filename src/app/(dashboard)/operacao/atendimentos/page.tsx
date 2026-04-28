import Link from 'next/link'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { ChevronRight, Filter, Plus, Stethoscope } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDateTime } from '@/lib/utils'
import {
  getDayRange,
  getMonthRange,
  getWeekRange,
  parseIsoDate,
} from '@/lib/utils/calendar'
import { listAppointmentsForWeek } from '@/lib/core/appointments/list-week'
import { AtendimentosToolbar } from './atendimentos-toolbar'
import { CalendarView } from './calendar/calendar-view'
import type { DoctorFilterOption } from './calendar/doctor-filter'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: {
    from?: string
    to?: string
    status?: 'agendado' | 'ativo' | 'estornado' | 'todos'
    view?: 'list' | 'cal'
    week?: string
    grain?: 'day' | 'week' | 'month'
    doctors?: string
  }
}

interface AppointmentRow {
  id: string | null
  patient_id: string | null
  doctor_id: string | null
  appointment_at: string | null
  duration_minutes: number | null
  effective_status: string | null
  procedures: { tuss_code: string; display_name: string | null } | null
  doctors: { full_name: string | null } | null
}

export default async function AtendimentosPage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')

  // View default por dispositivo: querystring tem precedencia, senao cookie,
  // senao 'cal' (default global da feature 005). Toolbar escreve o cookie ao
  // alternar para persistir a preferencia entre recargas.
  const cookieView = cookies().get('pronttu_atendimentos_view')?.value
  const view: 'list' | 'cal' =
    searchParams.view === 'cal'
      ? 'cal'
      : searchParams.view === 'list'
        ? 'list'
        : cookieView === 'list'
          ? 'list'
          : 'cal'
  const grain = searchParams.grain ?? 'week'
  const weekDate = parseIsoDate(searchParams.week) ?? new Date()
  const selectedDoctors = (searchParams.doctors ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>

  // Lista de profissionais do tenant para o filtro do calendario.
  const { data: doctorsRaw } = await supabase
    .from('doctors')
    .select('id, full_name, active')
    .order('active', { ascending: false })
    .order('full_name', { ascending: true })
  const doctorOptions: DoctorFilterOption[] = (
    (doctorsRaw ?? []) as Array<{ id: string; full_name: string; active: boolean | null }>
  ).map((d) => ({
    id: d.id,
    fullName: d.full_name,
    active: d.active !== false,
  }))

  if (view === 'cal') {
    const range =
      grain === 'day'
        ? getDayRange(weekDate)
        : grain === 'month'
          ? getMonthRange(weekDate)
          : getWeekRange(weekDate)

    const encryptionKey = process.env.PATIENT_DATA_ENCRYPTION_KEY
    const service = encryptionKey ? createSupabaseServiceClient() : undefined
    const appointments = await listAppointmentsForWeek(
      supabase,
      {
        tenantId: session.tenantId,
        weekStart: range.start,
        weekEnd: range.end,
        doctorIds: selectedDoctors.length > 0 ? selectedDoctors : undefined,
      },
      { serviceClient: service, encryptionKey },
    )

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-900">Atendimentos</h1>
            <p className="mt-1 text-sm text-slate-500">
              {appointments.length} no período selecionado
              {selectedDoctors.length > 0 ? (
                <>
                  {' '}
                  · filtrado por{' '}
                  <span className="font-semibold text-slate-700">
                    {selectedDoctors.length} profissional
                    {selectedDoctors.length === 1 ? '' : 'is'}
                  </span>
                </>
              ) : null}
            </p>
          </div>
          {session.role === 'admin' || session.role === 'recepcionista' ? (
            <Button asChild>
              <Link href="/operacao/atendimentos/novo">
                <Plus className="mr-2 h-4 w-4" />
                Novo atendimento
              </Link>
            </Button>
          ) : null}
        </div>

        <AtendimentosToolbar
          view={view}
          weekDate={weekDate}
          grain={grain}
          doctorOptions={doctorOptions}
          selectedDoctors={selectedDoctors}
        />

        <CalendarView range={range} appointments={appointments} />
      </div>
    )
  }

  // ---- Visualização Lista (default) ----
  let query = supabase
    .from('appointments_effective')
    .select(
      'id, patient_id, doctor_id, appointment_at, duration_minutes, effective_status, ' +
        'procedures:procedure_id(tuss_code, display_name), ' +
        'doctors:doctor_id(full_name)',
    )
    .order('appointment_at', { ascending: false })
    .limit(200)

  if (searchParams.from) query = query.gte('appointment_at', searchParams.from)
  if (searchParams.to) query = query.lte('appointment_at', searchParams.to)
  const statusFilter = searchParams.status ?? 'todos'
  if (statusFilter !== 'todos') query = query.eq('effective_status', statusFilter)
  // Filtro multi-profissional vindo do toolbar (mesmo querystring usado no Calendario).
  if (selectedDoctors.length > 0) query = query.in('doctor_id', selectedDoctors)

  const { data: rawRows, error } = await query
  const rows = (rawRows ?? []) as unknown as AppointmentRow[]

  const patientNames = new Map<string, string>()
  const encryptionKey = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (rows.length > 0 && encryptionKey) {
    const patientIds = Array.from(
      new Set(rows.map((r) => r.patient_id).filter((id): id is string => Boolean(id))),
    )
    if (patientIds.length > 0) {
      const service = createSupabaseServiceClient()
      const { data: patientsRaw } = await service.rpc('decrypt_patient_names_for_ids', {
        p_tenant_id: session.tenantId,
        p_patient_ids: patientIds,
        p_key: encryptionKey,
      })
      for (const p of patientsRaw ?? []) {
        patientNames.set(p.id, p.anonymized_at ? '[anonimizado]' : p.full_name || '—')
      }
    }
  }

  const reversedCount = rows.filter((r) => r.effective_status === 'estornado').length

  // Carrega contagem de alergias por paciente (badge na lista). Apenas
  // exibicao clinica — nao bloqueia render se a query falhar.
  const allergyCount = new Map<string, number>()
  if (rows.length > 0) {
    const patientIds = Array.from(
      new Set(rows.map((r) => r.patient_id).filter((id): id is string => Boolean(id))),
    )
    if (patientIds.length > 0) {
      const { data: allergyRows } = await supabase
        .from('patient_allergies')
        .select('patient_id')
        .in('patient_id', patientIds)
        .is('deleted_at', null)
      for (const a of (allergyRows ?? []) as Array<{ patient_id: string }>) {
        allergyCount.set(a.patient_id, (allergyCount.get(a.patient_id) ?? 0) + 1)
      }
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">Atendimentos</h1>
          <p className="mt-1 text-sm text-slate-500">
            {rows.length} atendimento{rows.length === 1 ? '' : 's'} no período
            {reversedCount > 0 ? (
              <>
                {' '}
                ·{' '}
                <span className="font-semibold text-rose-600">
                  {reversedCount} estornado{reversedCount === 1 ? '' : 's'}
                </span>
              </>
            ) : null}
          </p>
        </div>
        {session.role === 'admin' || session.role === 'recepcionista' ? (
          <Button asChild>
            <Link href="/operacao/atendimentos/novo">
              <Plus className="mr-2 h-4 w-4" />
              Novo atendimento
            </Link>
          </Button>
        ) : null}
      </div>

      <AtendimentosToolbar
        view={view}
        weekDate={weekDate}
        grain={grain}
        doctorOptions={doctorOptions}
        selectedDoctors={selectedDoctors}
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Filter className="h-4 w-4 text-primary" />
            Filtros
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form method="get" className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="from" className="text-xs">
                Data inicial
              </Label>
              <Input id="from" name="from" type="date" defaultValue={searchParams.from} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to" className="text-xs">
                Data final
              </Label>
              <Input id="to" name="to" type="date" defaultValue={searchParams.to} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="status" className="text-xs">
                Status
              </Label>
              <select
                id="status"
                name="status"
                defaultValue={statusFilter}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="todos">Todos</option>
                <option value="agendado">Agendados</option>
                <option value="ativo">Ativos</option>
                <option value="estornado">Estornados</option>
              </select>
            </div>
            <Button type="submit">Filtrar</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {error ? (
            <p className="px-6 py-8 text-sm text-rose-600">Erro ao carregar: {error.message}</p>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <Stethoscope className="h-8 w-8 text-slate-300" />
              <p className="text-sm font-medium text-slate-500">
                Nenhum atendimento encontrado no período.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Início</TableHead>
                  <TableHead>Fim</TableHead>
                  <TableHead>Paciente</TableHead>
                  <TableHead>Procedimento</TableHead>
                  <TableHead>Profissional</TableHead>
                  <TableHead>Alergias</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const startMs = r.appointment_at ? new Date(r.appointment_at).getTime() : null
                  const endIso =
                    startMs !== null
                      ? new Date(startMs + (r.duration_minutes ?? 30) * 60_000).toISOString()
                      : null
                  const allergyN = r.patient_id ? allergyCount.get(r.patient_id) ?? 0 : 0
                  return (
                    <TableRow key={r.id ?? Math.random()} className="group">
                      <TableCell className="font-medium text-slate-700">
                        {formatDateTime(r.appointment_at)}
                      </TableCell>
                      <TableCell className="font-medium text-slate-700">
                        {endIso ? formatDateTime(endIso).split(' ').pop() : '—'}
                      </TableCell>
                      <TableCell className="font-medium text-slate-900">
                        {r.patient_id ? patientNames.get(r.patient_id) ?? '—' : '—'}
                      </TableCell>
                      <TableCell className="text-slate-700">
                        {r.procedures ? (
                          <span>
                            <span className="font-mono text-xs text-slate-500">
                              {r.procedures.tuss_code}
                            </span>
                            {r.procedures.display_name ? (
                              <span className="ml-2">{r.procedures.display_name}</span>
                            ) : null}
                          </span>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell className="text-slate-700">
                        {r.doctors?.full_name ?? '—'}
                      </TableCell>
                      <TableCell>
                        {allergyN > 0 ? (
                          <Badge variant="destructive">
                            {allergyN === 1 ? '1 alergia' : `${allergyN} alergias`}
                          </Badge>
                        ) : (
                          <span className="text-[11px] text-slate-400">NKDA</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.effective_status === 'estornado' ? (
                          <Badge variant="destructive">estornado</Badge>
                        ) : r.effective_status === 'agendado' ||
                          (r.appointment_at &&
                            new Date(r.appointment_at).getTime() > Date.now()) ? (
                          <Badge
                            variant="secondary"
                            className="border-sky-200 bg-sky-50 text-sky-800"
                          >
                            agendado
                          </Badge>
                        ) : (
                          <Badge variant="success">ativo</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.id ? (
                          <Link
                            href={`/operacao/atendimentos/${r.id}`}
                            className="inline-flex items-center gap-1 text-xs font-bold text-primary opacity-0 transition-opacity group-hover:opacity-100"
                          >
                            Abrir <ChevronRight className="h-3 w-3" />
                          </Link>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

