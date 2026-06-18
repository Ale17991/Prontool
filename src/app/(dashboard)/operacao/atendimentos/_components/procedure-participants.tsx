'use client'

import { useCallback, useEffect, useState } from 'react'
import { Trash2, Users, Plus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatCurrency } from '@/lib/utils'

interface ParticipantDTO {
  participantId: string
  procedureId: string
  doctorId: string
  doctorName: string
  participationDegree: string | null
  degreeLabel: string | null
  amountCents: number | null
}

interface CatalogResponse {
  participants: ParticipantDTO[]
  doctors: { id: string; fullName: string }[]
  degrees: { code: string; label: string }[]
  canViewValues: boolean
}

interface Props {
  appointmentId: string
  /** Linhas de procedimento do atendimento: id de `appointment_procedures` + rótulo. */
  procedures: { id: string; label: string }[]
  /** admin/financeiro podem adicionar/remover; demais só visualizam. */
  canManage: boolean
}

/**
 * Feature 031 — equipe (participantes adicionais) POR LINHA DE PROCEDIMENTO.
 * Self-contained: busca participantes + catálogo (médicos ativos, graus do
 * domínio TISS 35) via GET e faz POST/DELETE imediatos, recarregando depois.
 * O executante principal do atendimento NÃO aparece aqui (FR-015).
 */
export function ProcedureParticipants({ appointmentId, procedures, canManage }: Props) {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/atendimentos/${appointmentId}/participantes`, {
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setCatalog((await res.json()) as CatalogResponse)
      setError(null)
    } catch {
      setError('Não foi possível carregar a equipe.')
    } finally {
      setLoading(false)
    }
  }, [appointmentId])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-1 py-2 text-xs text-slate-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando equipe…
      </div>
    )
  }
  if (error || !catalog) {
    return <p className="px-1 py-2 text-xs text-rose-600">{error ?? 'Erro.'}</p>
  }

  return (
    <div className="space-y-3">
      {procedures.map((proc) => (
        <ProcedureBlock
          key={proc.id}
          appointmentId={appointmentId}
          procedure={proc}
          catalog={catalog}
          canManage={canManage}
          onChanged={load}
        />
      ))}
    </div>
  )
}

function ProcedureBlock({
  appointmentId,
  procedure,
  catalog,
  canManage,
  onChanged,
}: {
  appointmentId: string
  procedure: { id: string; label: string }
  catalog: CatalogResponse
  canManage: boolean
  onChanged: () => Promise<void>
}) {
  const rows = catalog.participants.filter((p) => p.procedureId === procedure.id)
  const usedDoctorIds = new Set(rows.map((r) => r.doctorId))
  const availableDoctors = catalog.doctors.filter((d) => !usedDoctorIds.has(d.id))

  const [doctorId, setDoctorId] = useState('')
  const [degree, setDegree] = useState('')
  const [amountReais, setAmountReais] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  async function add() {
    setFormError(null)
    const amountCents = Math.round(Number(amountReais) * 100)
    if (!doctorId || !degree || !Number.isFinite(amountCents) || amountCents <= 0) {
      setFormError('Selecione profissional, grau e honorário (> 0).')
      return
    }
    setBusy(true)
    try {
      const res = await fetch(`/api/atendimentos/${appointmentId}/participantes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          procedureId: procedure.id,
          doctorId,
          participationDegree: degree,
          amountCents,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`)
      }
      setDoctorId('')
      setDegree('')
      setAmountReais('')
      await onChanged()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Falha ao adicionar.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(participantId: string) {
    setBusy(true)
    try {
      const res = await fetch(
        `/api/atendimentos/${appointmentId}/participantes/${participantId}`,
        { method: 'DELETE' },
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await onChanged()
    } catch {
      setFormError('Falha ao remover.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50/40 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-600">
        <Users className="h-3.5 w-3.5" /> Equipe — {procedure.label}
      </div>

      {rows.length === 0 ? (
        <p className="text-[11px] text-slate-500">Nenhum participante adicional neste procedimento.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((p) => (
            <li
              key={p.participantId}
              className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5"
            >
              <span className="flex-1 text-sm font-semibold text-slate-800">{p.doctorName}</span>
              <span className="text-xs text-slate-500">{p.degreeLabel ?? p.participationDegree ?? '—'}</span>
              <span className="text-xs font-medium text-slate-700">
                {p.amountCents !== null ? formatCurrency(p.amountCents) : '—'}
              </span>
              {canManage ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => remove(p.participantId)}
                  disabled={busy}
                  title="Remover participante"
                  className="h-7 px-2"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <select
            value={doctorId}
            onChange={(e) => setDoctorId(e.target.value)}
            disabled={busy || availableDoctors.length === 0}
            className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Profissional…</option>
            {availableDoctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.fullName}
              </option>
            ))}
          </select>
          <select
            value={degree}
            onChange={(e) => setDegree(e.target.value)}
            disabled={busy}
            className="h-8 w-40 rounded-md border border-input bg-background px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Grau…</option>
            {catalog.degrees.map((g) => (
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
              disabled={busy}
              className="h-8 w-24 text-sm"
            />
          </div>
          <Button type="button" size="sm" onClick={add} disabled={busy} className="h-8 px-3">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            <span className="ml-1">Adicionar</span>
          </Button>
        </div>
      ) : null}

      {formError ? <p className="mt-1.5 text-[11px] text-rose-600">{formError}</p> : null}
    </div>
  )
}
