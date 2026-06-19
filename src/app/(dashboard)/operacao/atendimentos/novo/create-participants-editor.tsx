'use client'

import { useState } from 'react'
import { Plus, Trash2, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface CreateParticipant {
  /** Índice da linha de procedimento (0-based) no editor de procedimentos. */
  procedureIndex: number
  doctorId: string
  participationDegree: string
  amountCents: number
}

export interface ParticipantProcedureRef {
  index: number
  label: string
}

export interface CreateParticipantsEditorProps {
  /** Linhas de procedimento já escolhidas (procedimento selecionado). */
  procedures: ParticipantProcedureRef[]
  /** Profissionais ativos elegíveis (qualquer modalidade). */
  doctors: { id: string; fullName: string }[]
  /** Graus de participação (domínio TISS 35). */
  degrees: { code: string; label: string }[]
  value: CreateParticipant[]
  onChange: (next: CreateParticipant[]) => void
  disabled?: boolean
}

/**
 * Feature 031 — equipe (participantes adicionais) POR LINHA DE PROCEDIMENTO,
 * já no momento da criação do atendimento. Espelha o fluxo da tela de detalhe
 * (`ProcedureParticipants`), mas opera sobre as linhas em rascunho: cada
 * participante referencia o índice da linha, resolvido para `procedure_id` no
 * servidor depois que o atendimento (e suas linhas) são criados.
 */
export function CreateParticipantsEditor({
  procedures,
  doctors,
  degrees,
  value,
  onChange,
  disabled,
}: CreateParticipantsEditorProps) {
  if (procedures.length === 0) {
    return (
      <div className="space-y-1 rounded-md border border-slate-200 bg-slate-50/40 p-3">
        <Label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-600">
          <Users className="h-3.5 w-3.5" /> Equipe (participantes)
        </Label>
        <p className="text-[11px] text-slate-500">
          Adicione um procedimento acima para incluir participantes na equipe.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <Label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-600">
        <Users className="h-3.5 w-3.5" /> Equipe (participantes) — opcional
      </Label>
      {procedures.map((proc) => (
        <ProcedureParticipantBlock
          key={proc.index}
          procedure={proc}
          doctors={doctors}
          degrees={degrees}
          rows={value.filter((p) => p.procedureIndex === proc.index)}
          disabled={disabled}
          onAdd={(row) => onChange([...value, row])}
          onRemove={(doctorId) =>
            onChange(
              value.filter(
                (p) => !(p.procedureIndex === proc.index && p.doctorId === doctorId),
              ),
            )
          }
        />
      ))}
    </div>
  )
}

function ProcedureParticipantBlock({
  procedure,
  doctors,
  degrees,
  rows,
  disabled,
  onAdd,
  onRemove,
}: {
  procedure: ParticipantProcedureRef
  doctors: { id: string; fullName: string }[]
  degrees: { code: string; label: string }[]
  rows: CreateParticipant[]
  disabled?: boolean
  onAdd: (row: CreateParticipant) => void
  onRemove: (doctorId: string) => void
}) {
  const usedIds = new Set(rows.map((r) => r.doctorId))
  const available = doctors.filter((d) => !usedIds.has(d.id))

  const [doctorId, setDoctorId] = useState('')
  const [degree, setDegree] = useState('')
  const [amountReais, setAmountReais] = useState('')
  const [error, setError] = useState<string | null>(null)

  function add() {
    setError(null)
    const amountCents = Math.round(Number(amountReais) * 100)
    if (!doctorId || !degree || !Number.isFinite(amountCents) || amountCents <= 0) {
      setError('Selecione profissional, grau e honorário (> 0).')
      return
    }
    onAdd({ procedureIndex: procedure.index, doctorId, participationDegree: degree, amountCents })
    setDoctorId('')
    setDegree('')
    setAmountReais('')
  }

  const nameById = new Map(doctors.map((d) => [d.id, d.fullName]))
  const labelByCode = new Map(degrees.map((g) => [g.code, g.label]))

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50/40 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-slate-700">
        {procedure.label}
      </div>

      {rows.length === 0 ? (
        <p className="text-[11px] text-slate-500">Nenhum participante neste procedimento.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((p) => (
            <li
              key={p.doctorId}
              className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5"
            >
              <span className="flex-1 text-sm font-semibold text-slate-800">
                {nameById.get(p.doctorId) ?? p.doctorId}
              </span>
              <span className="text-xs text-slate-500">
                {labelByCode.get(p.participationDegree) ?? p.participationDegree}
              </span>
              <span className="text-xs font-medium text-slate-700">
                R$ {(p.amountCents / 100).toFixed(2)}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onRemove(p.doctorId)}
                disabled={disabled}
                title="Remover participante"
                className="h-7 px-2"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap items-end gap-2">
        <select
          value={doctorId}
          onChange={(e) => setDoctorId(e.target.value)}
          disabled={disabled || available.length === 0}
          className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">Profissional…</option>
          {available.map((d) => (
            <option key={d.id} value={d.id}>
              {d.fullName}
            </option>
          ))}
        </select>
        <select
          value={degree}
          onChange={(e) => setDegree(e.target.value)}
          disabled={disabled}
          className="h-8 w-40 rounded-md border border-input bg-background px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">Grau…</option>
          {degrees.map((g) => (
            <option key={g.code} value={g.code}>
              {g.label}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-1">
          <span className="text-xs text-slate-500">R$</span>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step={0.01}
            placeholder="0,00"
            value={amountReais}
            onChange={(e) => setAmountReais(e.target.value)}
            disabled={disabled}
            className="h-8 w-24 text-sm"
          />
        </div>
        <Button type="button" size="sm" onClick={add} disabled={disabled} className="h-8 px-3">
          <Plus className="h-3.5 w-3.5" />
          <span className="ml-1">Adicionar</span>
        </Button>
      </div>

      {error ? <p className="mt-1.5 text-[11px] text-rose-600">{error}</p> : null}
    </div>
  )
}
