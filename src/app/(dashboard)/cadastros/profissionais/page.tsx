import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronRight, Stethoscope, UserCheck } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { can } from '@/lib/auth/rbac'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatBps, formatDate } from '@/lib/utils'
import { getEnabledIntegrations } from '@/lib/core/integrations/config'
import { NewDoctorForm } from './new-doctor-form'
import { ToggleActiveDoctor } from './toggle-active-doctor'

export const dynamic = 'force-dynamic'

interface DoctorRow {
  id: string
  full_name: string
  crm: string
  external_identifier: string | null
  role: string
  specialty: string | null
  council_name: string | null
  council_number: string | null
  active: boolean
  created_at: string
}

interface CommissionHead {
  doctor_id: string
  percentage_bps: number
  valid_from: string
}

export default async function ProfissionaisPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const supabase = createSupabaseServerClient()
  const service = createSupabaseServiceClient()
  const [doctorsRes, headsRes, integrations] = await Promise.all([
    supabase
      .from('doctors')
      .select(
        'id, full_name, crm, external_identifier, role, specialty, council_name, council_number, active, created_at',
      )
      .order('active', { ascending: false })
      .order('full_name', { ascending: true })
      .limit(500),
    supabase.from('doctor_commission_current').select('doctor_id, percentage_bps, valid_from'),
    getEnabledIntegrations(service, session.tenantId),
  ])
  const hasGhlIntegration = integrations.some((i) => i.provider === 'ghl')
  const doctors = (doctorsRes.data ?? []) as DoctorRow[]
  const heads = new Map<string, CommissionHead>()
  for (const h of (headsRes.data ?? []) as CommissionHead[]) heads.set(h.doctor_id, h)

  const canWrite = can(session.role, 'doctor.write')
  const activeCount = doctors.filter((d) => d.active).length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900">Profissionais</h1>
        <p className="mt-1 text-sm text-slate-500">
          {doctors.length} profissiona{doctors.length === 1 ? 'l' : 'is'} · {activeCount} ativo
          {activeCount === 1 ? '' : 's'} · comissões congeladas por atendimento
          (mudanças não afetam atendimentos anteriores)
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.5fr]">
        {canWrite ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Stethoscope className="h-4 w-4 text-primary" />
                Novo profissional
              </CardTitle>
            </CardHeader>
            <CardContent>
              <NewDoctorForm />
              <p className="mt-3 text-[11px] text-slate-500">
                A comissão inicial vira a primeira linha do histórico (imutável). Para alterar
                depois, use o botão “Nova comissão” no detalhe do profissional.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-8 text-sm text-slate-500">
              Seu perfil tem acesso somente de leitura aos profissionais e comissões.
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Cadastrados</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {doctorsRes.error ? (
              <p className="px-6 pb-6 text-sm text-rose-600">Erro: {doctorsRes.error.message}</p>
            ) : doctors.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
                <UserCheck className="h-8 w-8 text-slate-300" />
                <p className="text-sm font-medium text-slate-500">
                  Nenhum profissional cadastrado ainda.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Função</TableHead>
                    <TableHead>Especialidade</TableHead>
                    <TableHead>Registro</TableHead>
                    <TableHead>Comissão vigente</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {doctors.map((d) => {
                    const head = heads.get(d.id)
                    const registro = d.council_number ?? d.crm
                    const conselho = d.council_name
                    return (
                      <TableRow key={d.id} className="group">
                        <TableCell>
                          <p className="font-semibold text-slate-900">{d.full_name}</p>
                          {hasGhlIntegration && d.external_identifier ? (
                            <p className="font-mono text-[10px] text-slate-500">
                              GHL: {d.external_identifier}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-xs font-semibold text-slate-700">
                          {d.role === 'profissional' ? '—' : d.role}
                        </TableCell>
                        <TableCell className="text-xs text-slate-600">
                          {d.specialty ?? '—'}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-slate-700">
                          {conselho ? (
                            <span className="font-bold">{conselho} </span>
                          ) : null}
                          {registro}
                        </TableCell>
                        <TableCell>
                          {head ? (
                            <>
                              <span className="font-bold text-slate-900">
                                {formatBps(head.percentage_bps)}
                              </span>
                              <p className="text-[10px] text-slate-500">
                                desde {formatDate(head.valid_from)}
                              </p>
                            </>
                          ) : (
                            <Badge variant="secondary">sem vigência</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {d.active ? (
                            <Badge variant="success">Ativo</Badge>
                          ) : (
                            <Badge variant="secondary">Inativo</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            {canWrite ? (
                              <ToggleActiveDoctor doctorId={d.id} active={d.active} />
                            ) : null}
                            <Link
                              href={`/cadastros/profissionais/${d.id}`}
                              className="inline-flex items-center gap-1 text-xs font-bold text-primary"
                            >
                              Abrir <ChevronRight className="h-3 w-3" />
                            </Link>
                          </div>
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
    </div>
  )
}
