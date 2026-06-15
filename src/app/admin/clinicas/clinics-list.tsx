'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Search, ChevronRight } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { PLAN_LABEL, type Plan } from '@/lib/core/entitlements/plans'

/**
 * Lista de clínicas estilo "sub-contas" — pesquisável, cada linha clicável leva
 * ao detalhe da clínica (/admin/clinicas/[id]) onde se edita plano/módulos e se
 * entra na clínica.
 */
export interface ClinicListRow {
  tenantId: string
  name: string
  slug: string
  status: string
  plan: Plan
}

export function ClinicsList({ rows }: { rows: ClinicListRow[] }) {
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return rows
    return rows.filter(
      (r) => r.name.toLowerCase().includes(t) || r.slug.toLowerCase().includes(t),
    )
  }, [rows, q])

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar clínica por nome ou slug…"
          className="pl-9"
          autoFocus
        />
      </div>
      <p className="text-[11px] text-slate-400">
        {filtered.length} de {rows.length} clínica{rows.length === 1 ? '' : 's'}
      </p>

      <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {filtered.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-400">Nenhuma clínica encontrada.</p>
        ) : (
          filtered.map((r) => (
            <Link
              key={r.tenantId}
              href={`/admin/clinicas/${r.tenantId}`}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-black text-primary">
                {(r.name || '?').charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-slate-900">{r.name}</p>
                <p className="truncate text-[11px] text-slate-400">{r.slug}</p>
              </div>
              <span className="hidden rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 sm:inline">
                {PLAN_LABEL[r.plan]}
              </span>
              {r.status !== 'active' ? (
                <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                  {r.status}
                </span>
              ) : null}
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
            </Link>
          ))
        )}
      </div>
    </div>
  )
}
