import Link from 'next/link'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { ChevronRight, Lock, Plus, Stethoscope } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { Badge } from '@/components/ui/badge'
import {
  AppointmentStatusBadge,
  effectiveStatusToVariant,
} from '@/components/ui/appointment-status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { format } from 'date-fns'
import { formatDateTime } from '@/lib/utils'
import {
  APPOINTMENT_WEEK_ROW_LIMIT,
  listAppointmentsForWeek,
} from '@/lib/core/appointments/list-week'
import { listScheduleBlocks } from '@/lib/core/schedule-blocks/list'
import { ModeToggle } from './mode-toggle'
import { CalendarShell } from './calendar-shell'
import { FilterBarBlock } from './filter-bar-block'
import { AppointmentDetailHost } from './_components/appointment-detail-host'
import {
  deriveRange,
  parseFiltersFromRecord,
  type CalendarStatus,
} from './calendar-filters'
import type { DoctorFilterOption } from './calendar/doctor-filter'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>
}

interface AppointmentRow {
  id: string | null
  patient_id: string | null
  doctor_id: string | null
  plan_id: string | null
  appointment_at: string | null
  duration_minutes: number | null
  effective_status: string | null
  procedures: { tuss_code: string; display_name: string | null } | null
  doctors: { full_name: string | null } | null
}

// UI status (filter-bar) → effective_status do DB (lista). No modo Calendário
// o list-week unifica por timestamp; aqui aplicamos direto.
const UI_TO_DB_STATUS: Record<CalendarStatus, 'agendado' | 'ativo' | 'estornado'> = {
  agendado: 'agendado',
  realizado: 'ativo',
  cancelado: 'estornado',
}

export default async function AtendimentosPage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')

  // Mode: querystring > cookie > 'cal'. Cookie legado mantém preferência por
  // dispositivo entre recargas sem querystring (feature 005).
  const cookieMode = cookies().get('prontool_atendimentos_view')?.value
  const modeParam = typeof searchParams.mode === 'string' ? searchParams.mode : null
  const mode: 'list' | 'cal' =
    modeParam === 'list'
      ? 'list'
      : modeParam === 'cal'
        ? 'cal'
        : cookieMode === 'list'
          ? 'list'
          : 'cal'

  const filters = parseFiltersFromRecord(searchParams)
  const range = deriveRange(filters)

  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>

  // Profissionais do tenant — alimenta o select do FilterBar em ambos os modos.
  // Defense in depth: filtro explícito de tenant_id mesmo com RLS-bound client.
  const { data: doctorsRaw } = await supabase
    .from('doctors')
    .select('id, full_name, active')
    .eq('tenant_id', session.tenantId)
    .order('active', { ascending: false })
    .order('full_name', { ascending: true })
  const doctorOptions: DoctorFilterOption[] = (
    (doctorsRaw ?? []) as Array<{ id: string; full_name: string; active: boolean | null }>
  ).map((d) => ({ id: d.id, fullName: d.full_name, active: d.active !== false }))

  const encryptionKey = process.env.PATIENT_DATA_ENCRYPTION_KEY

  if (mode === 'cal') {
    // Defense in depth: se a query do calendário ou o render falhar
    // (RLS, view desatualizada, hook quebrado, etc.), cai pra Lista
    // em vez de derrubar a rota. List é mais simples e usa apenas a
    // view appointments_effective + RLS direto, sem service client.
    try {
      const service = encryptionKey ? createSupabaseServiceClient() : undefined
      const appointments = await listAppointmentsForWeek(
        supabase,
        {
          tenantId: session.tenantId,
          weekStart: range.from,
          weekEnd: range.to,
          doctorIds: filters.doctor ? [filters.doctor] : undefined,
        },
        { serviceClient: service, encryptionKey },
      )

      // Bloqueios de agenda da mesma janela. Degrada gracioso (lista vazia)
      // se migration 0083 nao estiver aplicada no ambiente.
      // Datas em fuso LOCAL (schedule_blocks.block_date e date sem fuso).
      // toISOString().slice(0,10) pegava a data UTC e em fuso UTC-3 o `to`
      // (endOfWeek = 23:59:59 local = next-day UTC) vinha 1 dia a frente.
      const scheduleBlocks = await listScheduleBlocks(supabase, {
        tenantId: session.tenantId,
        from: format(range.from, 'yyyy-MM-dd'),
        to: format(range.to, 'yyyy-MM-dd'),
        doctorId: filters.doctor ?? undefined,
      }).catch(() => [])

      return (
        <AppointmentDetailHost role={session.role}>
          <div className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h1 className="text-2xl font-black tracking-tight text-slate-900">Atendimentos</h1>
                {appointments.length >= APPOINTMENT_WEEK_ROW_LIMIT ? (
                  <p className="mt-1 text-sm font-medium text-amber-600">
                    Limite de {APPOINTMENT_WEEK_ROW_LIMIT} atendimentos atingido —
                    estreite o período para garantir que nada esteja oculto.
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-slate-500">
                    {appointments.length} no período carregado
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <ModeToggle mode={mode} />
                <Button asChild variant="outline">
                  <Link href="/operacao/atendimentos/bloquear">
                    <Lock className="mr-2 h-4 w-4" />
                    Bloquear horário
                  </Link>
                </Button>
                {session.role === 'admin' || session.role === 'recepcionista' ? (
                  <Button asChild>
                    <Link href="/operacao/atendimentos/novo">
                      <Plus className="mr-2 h-4 w-4" />
                      Novo
                    </Link>
                  </Button>
                ) : null}
              </div>
            </div>

            <CalendarShell
              appointments={appointments}
              doctors={doctorOptions}
              scheduleBlocks={scheduleBlocks}
              canManageBlocks={true}
            />
          </div>
        </AppointmentDetailHost>
      )
    } catch (err) {
      console.error('atendimentos cal-mode failed, falling back to list', err)
      // fall through pro código de modo Lista abaixo.
    }
  }

  // ---- Modo Lista ----
  // Defense in depth: filtro explícito de tenant_id mesmo na view
  // appointments_effective. A migration 0068 garante security_invoker=true,
  // mas o filtro explícito é cinto + suspensório caso RLS falhe.
  // Limit 1000 (subido de 200): periodos longos com tenant ativo passavam
  // facil de 200 e truncavam silenciosamente os dias mais antigos.
  const LIST_MODE_LIMIT = 1000
  let query = supabase
    .from('appointments_effective')
    .select(
      'id, patient_id, doctor_id, plan_id, appointment_at, duration_minutes, effective_status, ' +
        'procedures:procedure_id(tuss_code, display_name), ' +
        'doctors:doctor_id(full_name)',
    )
    .eq('tenant_id', session.tenantId)
    .order('appointment_at', { ascending: false })
    .limit(LIST_MODE_LIMIT)

  if (filters.from) {
    query = query.gte('appointment_at', new Date(`${filters.from}T00:00:00`).toISOString())
  }
  if (filters.to) {
    query = query.lte('appointment_at', new Date(`${filters.to}T23:59:59.999`).toISOString())
  }
  if (filters.status) {
    query = query.eq('effective_status', UI_TO_DB_STATUS[filters.status])
  }
  if (filters.doctor) {
    query = query.eq('doctor_id', filters.doctor)
  }

  const { data: rawRows, error } = await query
  const rows = (rawRows ?? []) as unknown as AppointmentRow[]

  // Decryption de nomes (mesmo padrão do cal mode via list-week).
  const patientNames = new Map<string, string>()
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

  // Contagem de alergias por paciente (badge informativo).
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

  // Filtros client-side que não compensam ir pro SQL: paciente está encrypted,
  // procedimento é substring leve em uma window já paginada (200 rows max).
  const filteredRows = rows.filter((r) => {
    if (filters.procedure) {
      const haystack = `${r.procedures?.tuss_code ?? ''} ${r.procedures?.display_name ?? ''}`.toLowerCase()
      if (!haystack.includes(filters.procedure.toLowerCase())) return false
    }
    if (filters.patient) {
      const name = r.patient_id ? (patientNames.get(r.patient_id) ?? '').toLowerCase() : ''
      if (!name.includes(filters.patient.toLowerCase())) return false
    }
    return true
  })

  const reversedCount = filteredRows.filter((r) => r.effective_status === 'estornado').length
  const listTruncated = rows.length >= LIST_MODE_LIMIT

  return (
    <AppointmentDetailHost role={session.role}>
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">Atendimentos</h1>
          {listTruncated ? (
            <p className="mt-1 text-sm font-medium text-amber-600">
              Limite de {LIST_MODE_LIMIT} atendimentos atingido — estreite o período
              para garantir que nada esteja oculto.
            </p>
          ) : (
            <p className="mt-1 text-sm text-slate-500">
              {filteredRows.length} atendimento{filteredRows.length === 1 ? '' : 's'}
              {reversedCount > 0 ? (
                <>
                  {' '}·{' '}
                  <span className="font-semibold text-destructive">
                    {reversedCount} cancelado{reversedCount === 1 ? '' : 's'}
                  </span>
                </>
              ) : null}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ModeToggle mode={mode} />
          {session.role === 'admin' || session.role === 'recepcionista' ? (
            <>
              <Button asChild variant="outline">
                <Link href="/operacao/atendimentos/bloquear">
                  <Lock className="mr-2 h-4 w-4" />
                  Bloquear horário
                </Link>
              </Button>
              <Button asChild>
                <Link href="/operacao/atendimentos/novo">
                  <Plus className="mr-2 h-4 w-4" />
                  Novo
                </Link>
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <FilterBarBlock doctors={doctorOptions} />

      <Card>
        <CardContent className="p-0">
          {error ? (
            <p className="px-6 py-8 text-sm text-destructive">Erro ao carregar: {error.message}</p>
          ) : filteredRows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <Stethoscope className="h-8 w-8 text-slate-300" />
              <p className="text-sm font-medium text-slate-500">
                Nenhum atendimento encontrado para os filtros aplicados.
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
                {filteredRows.map((r) => {
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
                          <span
                            className="text-[11px] text-slate-400"
                            title="NKDA — No Known Drug Allergies"
                          >
                            Sem alergias
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          <AppointmentStatusBadge
                            variant={effectiveStatusToVariant(
                              r.effective_status === 'agendado' ||
                                (r.appointment_at &&
                                  new Date(r.appointment_at).getTime() > Date.now())
                                ? 'agendado'
                                : r.effective_status,
                            )}
                            size="sm"
                          />
                          {r.plan_id === null ? (
                            <Badge variant="warning" className="text-[10px]">
                              particular
                            </Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {r.id ? (
                          <Link
                            href={`/operacao/atendimentos/${r.id}`}
                            data-appointment-id={r.id}
                            className="inline-flex items-center gap-1 text-xs font-bold text-link hover:text-link-hover opacity-0 transition-opacity group-hover:opacity-100"
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
    </AppointmentDetailHost>
  )
}
