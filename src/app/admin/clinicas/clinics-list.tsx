'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ChevronRight,
  Loader2,
  PauseCircle,
  PlayCircle,
  Plug,
  Search,
  Boxes,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PLAN_LABEL, type Plan } from '@/lib/core/entitlements/plans'
import { adminBulkSetTenantStatusAction } from '../actions'

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
const PAGE_SIZE = 25

export function ClinicsList({ rows }: { rows: ClinicListRow[] }) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [statusF, setStatusF] = useState<'all' | 'active' | 'suspended'>('all')
  const [planF, setPlanF] = useState<'all' | Plan>('all')
  const [sort, setSort] = useState<SortKey>('name')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pending, startTransition] = useTransition()

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

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  function toggleSel(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleAllPage(on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const r of pageRows) {
        if (on) next.add(r.tenantId)
        else next.delete(r.tenantId)
      }
      return next
    })
  }
  const allPageSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.tenantId))

  function bulkStatus(status: 'active' | 'suspended') {
    if (status === 'suspended' && typeof window !== 'undefined') {
      if (
        !window.confirm(`Suspender ${selected.size} clínica(s)? Os usuários delas perdem acesso.`)
      )
        return
    }
    startTransition(async () => {
      const res = await adminBulkSetTenantStatusAction({ tenantIds: [...selected], status })
      if (res.ok) {
        setSelected(new Set())
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setPage(0)
            }}
            placeholder="Buscar por nome ou slug…"
            className="pl-9"
          />
        </div>
        <Select
          value={statusF}
          onChange={(v) => {
            setStatusF(v as typeof statusF)
            setPage(0)
          }}
        >
          <option value="all">Todos os status</option>
          <option value="active">Ativas</option>
          <option value="suspended">Suspensas</option>
        </Select>
        <Select
          value={planF}
          onChange={(v) => {
            setPlanF(v as typeof planF)
            setPage(0)
          }}
        >
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

      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
          <span className="font-semibold text-primary">{selected.size} selecionada(s)</span>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => bulkStatus('active')}
            className="h-7 gap-1.5"
          >
            <PlayCircle className="h-3.5 w-3.5" /> Reativar
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => bulkStatus('suspended')}
            className="h-7 gap-1.5 text-destructive"
          >
            <PauseCircle className="h-3.5 w-3.5" /> Suspender
          </Button>
          {pending ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : null}
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ml-auto text-slate-400 hover:text-slate-600"
          >
            Limpar
          </button>
        </div>
      ) : (
        <p className="text-[11px] text-slate-400">
          {filtered.length} de {rows.length} clínica{rows.length === 1 ? '' : 's'}
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-[10px] uppercase tracking-widest text-slate-500">
              <th className="px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={allPageSelected}
                  onChange={(e) => toggleAllPage(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300"
                  aria-label="Selecionar página"
                />
              </th>
              <th className="px-2 py-2.5 font-bold">Clínica</th>
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
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-6 text-center text-sm text-slate-400">
                  Nenhuma clínica encontrada.
                </td>
              </tr>
            ) : (
              pageRows.map((r) => {
                const billing = r.billingStatus ? BILLING_LABEL[r.billingStatus] : null
                return (
                  <tr key={r.tenantId} className="group border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={selected.has(r.tenantId)}
                        onChange={() => toggleSel(r.tenantId)}
                        className="h-3.5 w-3.5 rounded border-slate-300"
                        aria-label={`Selecionar ${r.name}`}
                      />
                    </td>
                    <td className="px-2 py-2.5">
                      <Link
                        href={`/admin/clinicas/${r.tenantId}`}
                        className="flex items-center gap-2.5"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-black text-primary">
                          {(r.name || '?').charAt(0).toUpperCase()}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-bold text-slate-900 group-hover:text-primary">
                            {r.name}
                          </span>
                          <span className="block truncate text-[11px] text-slate-400">
                            {r.slug}
                          </span>
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
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${billing.cls}`}
                          >
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
                    <td className="px-3 py-2.5 text-[11px] text-slate-500">
                      {fmtDate(r.createdAt)}
                    </td>
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

      {pageCount > 1 ? (
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>
            Página {safePage + 1} de {pageCount}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
              className="h-7"
            >
              Anterior
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage(safePage + 1)}
              className="h-7"
            >
              Próxima
            </Button>
          </div>
        </div>
      ) : null}
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
