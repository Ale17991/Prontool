'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { DentalStatusDTO, DentalStatusScope } from '@/lib/core/dental/status-catalog/list'
import { createStatusAction, updateStatusAction } from './actions'

interface Props {
  mode: 'create' | 'edit'
  initial?: DentalStatusDTO | null
  onClose: () => void
}

const SCOPE_LABEL: Record<DentalStatusScope, string> = {
  tooth: 'Dente inteiro',
  face: 'Face',
  both: 'Ambos',
}

export function StatusForm({ mode, initial, onClose }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [code, setCode] = useState(initial?.code ?? '')
  const [label, setLabel] = useState(initial?.label ?? '')
  const [color, setColor] = useState(initial?.color ?? '#2563eb')
  const [icon, setIcon] = useState(initial?.icon ?? '')
  const [scope, setScope] = useState<DentalStatusScope>(initial?.scope ?? 'face')
  const [tussCode, setTussCode] = useState('')
  const [sortOrder, setSortOrder] = useState<number>(initial?.sortOrder ?? 0)

  function submit() {
    setError(null)
    startTransition(async () => {
      const res =
        mode === 'create'
          ? await createStatusAction({
              code,
              label,
              color,
              icon: icon || null,
              scope,
              tussCode: tussCode || null,
              sortOrder,
            })
          : await updateStatusAction({
              id: initial!.id,
              label,
              color,
              icon: icon || null,
              scope,
              tussCode: tussCode || undefined,
              sortOrder,
            })
      if (!res.ok) {
        setError(res.error ?? 'Falha ao salvar.')
        return
      }
      router.refresh()
      onClose()
    })
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <h3 className="text-sm font-bold text-slate-900">
        {mode === 'create' ? 'Novo status' : `Editar “${initial?.label}”`}
      </h3>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {mode === 'create' ? (
          <label className="text-xs font-medium text-slate-600">
            Código (slug, imutável)
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="ex.: mancha_branca"
              className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1 text-sm"
            />
          </label>
        ) : (
          <div className="text-xs font-medium text-slate-600">
            Código
            <p className="mt-1 rounded-md bg-slate-100 px-2 py-1 font-mono text-sm text-slate-500">
              {initial?.code}
            </p>
          </div>
        )}

        <label className="text-xs font-medium text-slate-600">
          Rótulo
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="ex.: Mancha branca"
            className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1 text-sm"
          />
        </label>

        <label className="text-xs font-medium text-slate-600">
          Cor
          <div className="mt-1 flex items-center gap-2">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-8 w-10 rounded border border-slate-200"
            />
            <input
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-full rounded-md border border-slate-200 px-2 py-1 font-mono text-sm"
            />
          </div>
        </label>

        <label className="text-xs font-medium text-slate-600">
          Escopo
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as DentalStatusScope)}
            className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1 text-sm"
          >
            {(['tooth', 'face', 'both'] as DentalStatusScope[]).map((s) => (
              <option key={s} value={s}>
                {SCOPE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs font-medium text-slate-600">
          Ícone (lucide, opcional)
          <input
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            placeholder="ex.: square"
            className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1 text-sm"
          />
        </label>

        <label className="text-xs font-medium text-slate-600">
          Código TUSS (tabela 22, opcional)
          <input
            value={tussCode}
            onChange={(e) => setTussCode(e.target.value)}
            placeholder={initial?.tussCodeId ? '(vínculo atual mantido se vazio)' : 'ex.: 81000307'}
            className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1 text-sm"
          />
        </label>

        <label className="text-xs font-medium text-slate-600">
          Ordem
          <input
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(Number(e.target.value))}
            className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1 text-sm"
          />
        </label>
      </div>

      {error ? <p className="text-xs text-red-600">{error}</p> : null}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={submit}
          className={cn(
            'rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white',
            'disabled:opacity-50',
          )}
        >
          {pending ? 'Salvando…' : 'Salvar'}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={onClose}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}
