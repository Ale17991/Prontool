'use client'

import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface LiberalDoctorOption {
  id: string
  fullName: string
  defaultAmountCents: number
}

export interface AssistantSelection {
  doctorId: string
  amountCents: number
}

export interface AssistantMultiSelectProps {
  options: LiberalDoctorOption[]
  value: AssistantSelection[]
  onChange: (next: AssistantSelection[]) => void
  disabled?: boolean
}

/**
 * Multi-select de profissionais Liberais como assistentes do atendimento.
 *
 * - Filtra para mostrar apenas Liberais (já vem filtrado em `options`).
 * - Bloqueia duplicata (UI + server-side via UNIQUE parcial).
 * - Valor por participação editável por linha (default = liberal_default_cents).
 */
export function AssistantMultiSelect({
  options,
  value,
  onChange,
  disabled,
}: AssistantMultiSelectProps) {
  const selectedIds = new Set(value.map((v) => v.doctorId))
  const available = options.filter((o) => !selectedIds.has(o.id))

  function addAssistant(doctorId: string) {
    const opt = options.find((o) => o.id === doctorId)
    if (!opt) return
    onChange([...value, { doctorId, amountCents: opt.defaultAmountCents }])
  }

  function removeAt(idx: number) {
    onChange(value.filter((_, i) => i !== idx))
  }

  function updateAmountAt(idx: number, cents: number) {
    onChange(value.map((row, i) => (i === idx ? { ...row, amountCents: cents } : row)))
  }

  if (options.length === 0) {
    return (
      <p className="text-[11px] text-slate-500">
        Nenhum profissional Liberal cadastrado nesta clínica. Para adicionar assistentes,
        cadastre um profissional com modalidade Liberal em{' '}
        <a
          href="/configuracoes/profissionais"
          className="font-semibold text-primary underline"
        >
          /configuracoes/profissionais
        </a>
        .
      </p>
    )
  }

  return (
    <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50/40 p-3">
      <Label className="text-[10px] font-bold uppercase tracking-widest text-slate-600">
        Profissionais assistentes (Liberal)
      </Label>
      {value.length === 0 ? (
        <p className="text-[11px] text-slate-500">
          Opcional — adicione um ou mais Liberais que participaram deste atendimento.
        </p>
      ) : null}

      <ul className="space-y-2">
        {value.map((row, idx) => {
          const opt = options.find((o) => o.id === row.doctorId)
          return (
            <li
              key={row.doctorId}
              className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2"
            >
              <span className="flex-1 text-sm font-semibold text-slate-800">
                {opt?.fullName ?? row.doctorId}
              </span>
              <div className="flex items-center gap-1">
                <span className="text-xs text-slate-500">R$</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.01}
                  value={(row.amountCents / 100).toFixed(2)}
                  onChange={(e) => {
                    const num = Number(e.target.value)
                    if (!Number.isFinite(num) || num < 0) return
                    updateAmountAt(idx, Math.round(num * 100))
                  }}
                  disabled={disabled}
                  className="h-8 w-24 text-sm"
                />
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => removeAt(idx)}
                disabled={disabled}
                title="Remover este assistente"
                className="h-8 px-2"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          )
        })}
      </ul>

      {available.length > 0 ? (
        <div className="flex items-center gap-2">
          <select
            disabled={disabled}
            onChange={(e) => {
              if (e.target.value) {
                addAssistant(e.target.value)
                e.target.value = ''
              }
            }}
            defaultValue=""
            className="flex h-8 flex-1 rounded-md border border-input bg-background px-3 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="" disabled>
              + Adicionar assistente…
            </option>
            {available.map((o) => (
              <option key={o.id} value={o.id}>
                {o.fullName} (R$ {(o.defaultAmountCents / 100).toFixed(2)})
              </option>
            ))}
          </select>
        </div>
      ) : value.length > 0 ? (
        <p className="text-[10px] text-slate-500">
          Todos os Liberais cadastrados já foram adicionados.
        </p>
      ) : null}
    </div>
  )
}
