'use client'

import { Fragment, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { DentalStatusDTO, DentalStatusScope } from '@/lib/core/dental/status-catalog/list'
import { updateStatusAction } from './actions'
import { StatusForm } from './status-form'

const SCOPE_LABEL: Record<DentalStatusScope, string> = {
  tooth: 'Dente',
  face: 'Face',
  both: 'Ambos',
}

export function StatusCatalogTable({ items }: { items: DentalStatusDTO[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  function toggleActive(s: DentalStatusDTO) {
    startTransition(async () => {
      const res = await updateStatusAction({ id: s.id, isActive: !s.isActive })
      if (res.ok) router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      {!creating ? (
        <button
          type="button"
          onClick={() => {
            setEditingId(null)
            setCreating(true)
          }}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white"
        >
          + Novo status
        </button>
      ) : (
        <StatusForm mode="create" onClose={() => setCreating(false)} />
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
            <tr>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Escopo</th>
              <th className="px-3 py-2">Ativo</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((s) => (
              <Fragment key={s.id}>
                <tr className={cn(!s.isActive && 'opacity-50')}>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-2 font-medium text-slate-800">
                      <span
                        className="h-3.5 w-3.5 rounded-full border border-black/10"
                        style={{ backgroundColor: s.color }}
                      />
                      {s.label}
                      {s.isSystem ? (
                        <span className="rounded bg-slate-100 px-1 text-[10px] text-slate-400">
                          sistema
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-500">{s.code}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{SCOPE_LABEL[s.scope]}</td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[11px] font-medium',
                        s.isActive
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-slate-100 text-slate-500',
                      )}
                    >
                      {s.isActive ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setCreating(false)
                          setEditingId(editingId === s.id ? null : s.id)
                        }}
                        className="text-xs font-medium text-slate-600 hover:text-slate-900"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        disabled={pending || (s.isSystem && s.isActive)}
                        onClick={() => toggleActive(s)}
                        title={
                          s.isSystem && s.isActive
                            ? 'Status de sistema não pode ser desativado'
                            : ''
                        }
                        className="text-xs font-medium text-slate-600 hover:text-slate-900 disabled:opacity-40"
                      >
                        {s.isActive ? 'Desativar' : 'Ativar'}
                      </button>
                    </div>
                  </td>
                </tr>
                {editingId === s.id ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-2">
                      <StatusForm mode="edit" initial={s} onClose={() => setEditingId(null)} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
