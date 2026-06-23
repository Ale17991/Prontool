'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, Plug, Search, Boxes, Users } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { PLAN_LABEL, type Plan } from '@/lib/core/entitlements/plans'

export interface ClinicListRow {
  tenantId: string
  name: string
  slug: string
  status: string
  createdAt: string
  plan: Plan
  billingStatus: string | null
  moduleCount: number
  userCount: number
  integrations: string[]
}

const BILLING_LABEL: Record<string, { label: string; cls: string }> = {
  trial: { label: 'Trial', cls: 'bg-blue-100 text-blue-700' },
  active: { label: 'Ativo', cls: 'bg-success-bg text-success-text' },
  past_due: { label: 'Inadimplente', cls: 'bg-amber-100 text-amber-700' },
  canceled: { label: 'Cancelado', cls: 'bg-slate-200 text-slate-600' },
}

type SortKey = 'name' | 'recent' | 'users'

export function ClinicsList({ rows }: { rows: ClinicListRow[] }) {
  const [q, setQ] = useState('')
  const [statusF, setStatusF] = useState<'all' | 'active' | 'suspended'>('all')
  const [planF, setPlanF] = useState<'all' | Plan>('all')
  const [sort, setSort] = useState<SortKey>('name')

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    let out = rows.filter((r) => {
      if (t && !r.name.toLowerCase().includes(t) && !r.slug.toLowerCase().includes(t)) return false
      if (statusF !== 'all' && r.status !== statusF) return false
      if (planF !== 'all' && r.plan !== planF) return false
      return true
    })
    out = [...out].sort((a, b) => {
      if (sort === 'recent') return (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
      if (sort === 'users') return b.userCount - a.userCount
      return a.name.localeCompare(b.name, 'pt-BR')
    })
    return out
  }, [rows, q, statusF, planF, sort])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nome ou slug…"
            className="pl-9"
          />
        </div>
        <Select value={statusF} onChange={(v) => setStatusF(v as typeof statusF)}>
          <option value="all">Todos os status</option>
          <option value="active">Ativas</option>
          <option value="suspended">Suspensas</option>
        </Select>
        <Select value={planF} onChange={(v) => setPlanF(v as typeof planF)}>
          <option value="all">Todos os planos</option>
          <option value="essencial">Essencial</option>
          <option value="pro">Pro</option>
          <option value="clinica">Clínica</option>
          <option value="legacy">Legado</option>
        </Select>
        <Select value={sort} onChange={(v) => setSort(v as SortKey)}>
          <option value="name">Ordenar: Nome</option>
          <option value="recent">Ordenar: Mais recentes</option>
          <option value="users">Ordenar: + usuários</option>
        </Select>
      </div>

      <p className="text-[11px] text-slate-400">
        {filtered.length} de {rows.length} clínica{rows.length === 1 ? '' : 's'}
      </p>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-[10px] uppercase tracking-widest text-slate-500">
              <th className="px-4 py-2.5 font-bold">Clínica</th>
              <th className="px-3 py-2.5 font-bold">Plano</th>
              <th className="px-3 py-2.5 font-bold">Status</th>
              <th className="px-3 py-2.5 text-center font-bold">Usuários</th>
              <th className="px-3 py-2.5 text-center font-bold">Módulos</th>
              <th className="px-3 py-2.5 font-bold">Integrações</th>
              <th className="px-3 py-2.5 font-bold">Criada</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-6 text-center text-sm text-slate-400">
                  Nenhuma clínica encontrada.
                </td>
              </tr>
            ) : (
              filtered.map((r) => {
                const billing = r.billingStatus ? BILLING_LABEL[r.billingStatus] : null
                return (
                  <tr key={r.tenantId} className="group border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2.5">
                      <Link href={`/admin/clinicas/${r.tenantId}`} className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-black text-primary">
                          {(r.name || '?').charAt(0).toUpperCase()}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-bold text-slate-900 group-hover:text-primary">
                            {r.name}
                          </span>
                          <span className="block truncate text-[11px] text-slate-400">{r.slug}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                        {PLAN_LABEL[r.plan]}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-col items-start gap-1">
                        <span
                          className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                            r.status === 'active'
                              ? 'bg-success-bg text-success-text'
                              : 'bg-amber-100 text-amber-700'
                          }`}
                        >
                          {r.status === 'active' ? 'Ativa' : 'Suspensa'}
                        </span>
                        {billing ? (
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${billing.cls}`}>
                            {billing.label}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className="inline-flex items-center gap-1 text-slate-700">
                        <Users className="h-3.5 w-3.5 text-slate-400" />
                        {r.userCount}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className="inline-flex items-center gap-1 text-slate-700">
                        <Boxes className="h-3.5 w-3.5 text-slate-400" />
                        {r.moduleCount}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      {r.integrations.length === 0 ? (
                        <span className="text-[11px] text-slate-300">—</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] text-slate-600">
                          <Plug className="h-3 w-3 text-slate-400" />
                          {r.integrations.join(', ')}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-[11px] text-slate-500">{fmtDate(r.createdAt)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <Link
                        href={`/admin/clinicas/${r.tenantId}`}
                        className="inline-flex items-center text-slate-300 group-hover:text-primary"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string
  onChange: (v: string) => void
  children: React.ReactNode
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 shadow-sm"
    >
      {children}
    </select>
  )
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR')
}
