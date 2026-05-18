import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, Calculator, History } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { can } from '@/lib/auth/rbac'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatBps, formatDate, formatDateTime } from '@/lib/utils'

export const dynamic = 'force-dynamic'

interface HeadRow {
  doctor_id: string
  percentage_bps: number
  valid_from: string
  doctors: { id: string; full_name: string; crm: string; active: boolean } | null
}

interface RecentChangeRow {
  id: string
  doctor_id: string
  percentage_bps: number
  valid_from: string
  reason: string
  created_at: string
  doctors: { full_name: string; crm: string } | null
}

export default async function ComissoesPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!can(session.role, 'doctor.read')) redirect('/operacao/atendimentos')

  const supabase = createSupabaseServerClient()
  // Defense in depth (incidente 2026-05-11): filtro explícito de tenant_id
  // em todas as queries de tabelas/views multi-tenant.
  const [headsRes, recentRes] = await Promise.all([
    supabase
      .from('doctor_commission_current')
      .select('doctor_id, percentage_bps, valid_from, doctors(id, full_name, crm, active)')
      .eq('tenant_id', session.tenantId)
      .order('valid_from', { ascending: false }),
    supabase
      .from('doctor_commission_history')
      .select(
        'id, doctor_id, percentage_bps, valid_from, reason, created_at, doctors(full_name, crm)',
      )
      .eq('tenant_id', session.tenantId)
      .order('created_at', { ascending: false })
      .limit(25),
  ])

  const heads = ((headsRes.data ?? []) as unknown as HeadRow[]).filter(
    (h) => h.doctors?.active !== false,
  )
  const recent = (recentRes.data ?? []) as unknown as RecentChangeRow[]

  const averageBps =
    heads.length > 0
      ? Math.round(heads.reduce((acc, h) => acc + h.percentage_bps, 0) / heads.length)
      : 0
  const maxBps = heads.reduce((acc, h) => Math.max(acc, h.percentage_bps), 0)
  const minBps = heads.reduce((acc, h) => Math.min(acc, h.percentage_bps), heads[0]?.percentage_bps ?? 0)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">Comissões</h1>
          <p className="mt-1 text-sm text-slate-500">
            Visão agregada dos percentuais vigentes + últimas mudanças no histórico
            append-only.
          </p>
        </div>
        <Link
          href="/configuracoes/profissionais"
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-primary/90"
        >
          Gerenciar profissionais
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <StatCard
          label="Profissionais ativos"
          value={heads.length.toString()}
        />
        <StatCard label="Comissão média" value={formatBps(averageBps)} />
        <StatCard label="Maior comissão" value={formatBps(maxBps)} />
        <StatCard label="Menor comissão" value={formatBps(minBps)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Calculator className="h-4 w-4 text-primary" />
            Comissão vigente por profissional
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {headsRes.error ? (
            <p className="px-6 pb-6 text-sm text-destructive">Erro: {headsRes.error.message}</p>
          ) : heads.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-slate-500">
              Nenhum profissional ativo com comissão vigente. Cadastre em{' '}
              <Link href="/configuracoes/profissionais" className="font-semibold text-link hover:text-link-hover underline">
                Profissionais
              </Link>
              .
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Profissional</TableHead>
                  <TableHead>Registro</TableHead>
                  <TableHead>Comissão</TableHead>
                  <TableHead>Desde</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {heads.map((h) => (
                  <TableRow key={h.doctor_id} className="group">
                    <TableCell className="font-semibold text-slate-900">
                      {h.doctors?.full_name ?? '—'}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-600">
                      {h.doctors?.crm ?? '—'}
                    </TableCell>
                    <TableCell className="font-bold text-slate-900">
                      {formatBps(h.percentage_bps)}
                    </TableCell>
                    <TableCell className="text-slate-700">{formatDate(h.valid_from)}</TableCell>
                    <TableCell className="text-right">
                      {h.doctors?.id ? (
                        <Link
                          href={`/configuracoes/profissionais/${h.doctors.id}`}
                          className="inline-flex items-center gap-1 text-xs font-bold text-link hover:text-link-hover opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          Abrir <ArrowRight className="h-3 w-3" />
                        </Link>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <History className="h-4 w-4 text-primary" />
            Últimas mudanças registradas
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {recent.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-slate-500">
              Nenhuma mudança de comissão registrada ainda.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>Profissional</TableHead>
                  <TableHead>Percentual</TableHead>
                  <TableHead>Vigência</TableHead>
                  <TableHead>Motivo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((r) => {
                  const today = new Date().toISOString().slice(0, 10)
                  const isFuture = r.valid_from > today
                  return (
                    <TableRow key={r.id} className="align-top">
                      <TableCell className="whitespace-nowrap text-xs text-slate-500">
                        {formatDateTime(r.created_at)}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/configuracoes/profissionais/${r.doctor_id}`}
                          className="font-semibold text-slate-900 hover:text-link hover:underline"
                        >
                          {r.doctors?.full_name ?? '—'}
                        </Link>
                        <p className="font-mono text-[10px] text-slate-500">
                          {r.doctors?.crm ?? ''}
                        </p>
                      </TableCell>
                      <TableCell className="font-bold text-slate-900">
                        {formatBps(r.percentage_bps)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-700">{formatDate(r.valid_from)}</span>
                          {isFuture ? <Badge variant="warning">Futura</Badge> : null}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-sm text-xs text-slate-600">
                        {r.reason}
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

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-6">
        <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
          {label}
        </p>
        <p className="text-xl font-black tracking-tight text-slate-900">{value}</p>
      </CardContent>
    </Card>
  )
}
