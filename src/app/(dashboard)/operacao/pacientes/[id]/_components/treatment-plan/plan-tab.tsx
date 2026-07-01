'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  SURFACES,
  surfaceLabel,
  PERMANENT_TEETH,
  DECIDUOUS_TEETH,
  type Surface,
} from '@/lib/core/dental/teeth'

interface PlanItem {
  id: string
  title: string
  status: 'pendente' | 'concluido' | 'cancelado'
  toothFdi: number | null
  surface: string | null
  budgetId: string | null
  currentPriceCents: number | null
  procedure: { id: string; displayName: string | null; tussCode: string }
}

interface Budget {
  id: string
  title: string | null
  status: 'proposto' | 'apresentado' | 'aceito' | 'recusado'
  frozenTotalCents: number | null
  acceptedAt: string | null
  createdAt: string
}

interface Progress {
  totalItems: number
  executedItems: number
  plannedValueCents: number
  executedValueCents: number
  hasItemsWithoutPrice: boolean
}

interface PlanView {
  items: PlanItem[]
  budgets: Budget[]
  progress: Progress
}

interface DoctorOpt {
  id: string
  fullName: string
  active: boolean
}
interface ProcedureOpt {
  id: string
  displayName: string | null
  tussCode: string | null
  tussDescription: string | null
}

const ALL_TEETH = [...PERMANENT_TEETH, ...DECIDUOUS_TEETH]
const BUDGET_STATUS_LABEL: Record<Budget['status'], string> = {
  proposto: 'Proposto',
  apresentado: 'Apresentado',
  aceito: 'Aceito',
  recusado: 'Recusado',
}

function brl(cents: number | null): string {
  if (cents === null) return '—'
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function procLabel(p: ProcedureOpt): string {
  return p.displayName || p.tussDescription || p.tussCode || 'Procedimento'
}

export function PlanTab({ patientId, canWrite }: { patientId: string; canWrite: boolean }) {
  const [plan, setPlan] = useState<PlanView | null>(null)
  const [doctors, setDoctors] = useState<DoctorOpt[]>([])
  const [procedures, setProcedures] = useState<ProcedureOpt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Form de novo item.
  const [showForm, setShowForm] = useState(false)
  const [fTooth, setFTooth] = useState<number>(ALL_TEETH[0]!)
  const [fSurface, setFSurface] = useState<string>('')
  const [fProcedure, setFProcedure] = useState<string>('')
  const [fDoctor, setFDoctor] = useState<string>('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [planRes, docRes, procRes] = await Promise.all([
        fetch(`/api/pacientes/${patientId}/plano`, { headers: { accept: 'application/json' } }),
        fetch(`/api/medicos`, { headers: { accept: 'application/json' } }),
        fetch(`/api/procedimentos`, { headers: { accept: 'application/json' } }),
      ])
      if (!planRes.ok) throw new Error(`HTTP ${planRes.status}`)
      setPlan(await planRes.json())
      setDoctors(docRes.ok ? await docRes.json() : [])
      setProcedures(procRes.ok ? await procRes.json() : [])
    } catch {
      setError('Não foi possível carregar o plano.')
    } finally {
      setLoading(false)
    }
  }, [patientId])

  useEffect(() => {
    void load()
  }, [load])

  const post = useCallback(
    async (url: string, body: unknown, method = 'POST') => {
      setBusy(true)
      setError(null)
      try {
        const res = await fetch(url, {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => null)
          throw new Error(j?.error?.message ?? `HTTP ${res.status}`)
        }
        setSelected(new Set())
        await load()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Falha na operação.')
      } finally {
        setBusy(false)
      }
    },
    [load],
  )

  const addItem = useCallback(() => {
    const proc = procedures.find((p) => p.id === fProcedure)
    if (!fProcedure || !fDoctor) {
      setError('Selecione procedimento e profissional.')
      return
    }
    void post(`/api/pacientes/${patientId}/plano/itens`, {
      tooth_fdi: fTooth,
      surface: fSurface || null,
      procedure_id: fProcedure,
      doctor_id: fDoctor,
      title: proc ? procLabel(proc) : 'Procedimento',
    }).then(() => setShowForm(false))
  }, [fProcedure, fDoctor, fTooth, fSurface, procedures, patientId, post])

  const toggleSel = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const selectableItems = useMemo(
    () => (plan?.items ?? []).filter((i) => i.status === 'pendente' && !i.budgetId),
    [plan],
  )

  const budgetById = useMemo(() => {
    const m = new Map<string, Budget>()
    for (const b of plan?.budgets ?? []) m.set(b.id, b)
    return m
  }, [plan])

  if (loading) return <p className="text-sm text-slate-500">Carregando plano…</p>
  if (!plan) return <p className="text-sm text-red-600">{error ?? 'Erro ao carregar.'}</p>

  return (
    <div className="space-y-5">
      {/* Progresso */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Itens"
          value={`${plan.progress.executedItems}/${plan.progress.totalItems}`}
          hint="executados"
        />
        <Stat label="Orçado" value={brl(plan.progress.plannedValueCents)} />
        <Stat label="Executado" value={brl(plan.progress.executedValueCents)} />
        <Stat
          label="Orçamentos"
          value={String(plan.budgets.length)}
          hint={plan.progress.hasItemsWithoutPrice ? 'há itens sem preço' : undefined}
        />
      </div>

      {error ? <p className="text-xs text-red-600">{error}</p> : null}

      {/* Ações */}
      {canWrite ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowForm((s) => !s)}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white"
          >
            + Adicionar item
          </button>
          <button
            type="button"
            disabled={busy || selected.size === 0}
            onClick={() =>
              post(`/api/pacientes/${patientId}/plano/orcamentos`, { step_ids: [...selected] })
            }
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-40"
          >
            Criar orçamento ({selected.size})
          </button>
        </div>
      ) : null}

      {/* Form novo item */}
      {showForm && canWrite ? (
        <div className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-5">
          <select
            value={fTooth}
            onChange={(e) => setFTooth(Number(e.target.value))}
            className="rounded border px-2 py-1 text-xs"
          >
            {ALL_TEETH.map((t) => (
              <option key={t} value={t}>
                Dente {t}
              </option>
            ))}
          </select>
          <select
            value={fSurface}
            onChange={(e) => setFSurface(e.target.value)}
            className="rounded border px-2 py-1 text-xs"
          >
            <option value="">Dente inteiro</option>
            {SURFACES.map((s) => (
              <option key={s} value={s}>
                {surfaceLabel(s as Surface, fTooth)}
              </option>
            ))}
          </select>
          <select
            value={fProcedure}
            onChange={(e) => setFProcedure(e.target.value)}
            className="rounded border px-2 py-1 text-xs"
          >
            <option value="">Procedimento…</option>
            {procedures.map((p) => (
              <option key={p.id} value={p.id}>
                {procLabel(p)}
              </option>
            ))}
          </select>
          <select
            value={fDoctor}
            onChange={(e) => setFDoctor(e.target.value)}
            className="rounded border px-2 py-1 text-xs"
          >
            <option value="">Profissional…</option>
            {doctors
              .filter((d) => d.active)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.fullName}
                </option>
              ))}
          </select>
          <button
            type="button"
            disabled={busy}
            onClick={addItem}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            Salvar
          </button>
        </div>
      ) : null}

      {/* Itens */}
      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-left font-semibold text-slate-500">
            <tr>
              {canWrite ? <th className="w-8 px-2 py-2" /> : null}
              <th className="px-3 py-2">Posição</th>
              <th className="px-3 py-2">Procedimento</th>
              <th className="px-3 py-2 text-right">Valor</th>
              <th className="px-3 py-2">Situação</th>
              {canWrite ? <th className="px-3 py-2" /> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {plan.items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-slate-400">
                  Nenhum item no plano.
                </td>
              </tr>
            ) : null}
            {plan.items.map((it) => {
              const b = it.budgetId ? budgetById.get(it.budgetId) : null
              const canExecute = canWrite && it.status === 'pendente' && b?.status === 'aceito'
              const selectable = canWrite && it.status === 'pendente' && !it.budgetId
              return (
                <tr key={it.id} className={cn(it.status === 'cancelado' && 'opacity-40')}>
                  {canWrite ? (
                    <td className="px-2 py-2">
                      {selectable ? (
                        <input
                          type="checkbox"
                          checked={selected.has(it.id)}
                          onChange={() => toggleSel(it.id)}
                        />
                      ) : null}
                    </td>
                  ) : null}
                  <td className="px-3 py-2">
                    {it.toothFdi ? `Dente ${it.toothFdi}` : '—'}
                    {it.surface
                      ? ` · ${surfaceLabel(it.surface as Surface, it.toothFdi ?? 11)}`
                      : ''}
                  </td>
                  <td className="px-3 py-2">{it.title}</td>
                  <td className="px-3 py-2 text-right">{brl(it.currentPriceCents)}</td>
                  <td className="px-3 py-2">
                    <span className="text-slate-600">{it.status}</span>
                    {b ? (
                      <span className="ml-1 text-slate-400">· {BUDGET_STATUS_LABEL[b.status]}</span>
                    ) : null}
                  </td>
                  {canWrite ? (
                    <td className="px-3 py-2 text-right">
                      {canExecute ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            post(
                              `/api/pacientes/${patientId}/plano/itens/${it.id}`,
                              { action: 'executar' },
                              'PATCH',
                            )
                          }
                          className="text-emerald-700 hover:underline"
                        >
                          Executar
                        </button>
                      ) : null}
                      {it.status === 'pendente' && !it.budgetId ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            post(
                              `/api/pacientes/${patientId}/plano/itens/${it.id}`,
                              { action: 'cancelar' },
                              'PATCH',
                            )
                          }
                          className="ml-2 text-slate-400 hover:underline"
                        >
                          Cancelar
                        </button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Orçamentos */}
      {plan.budgets.length > 0 ? (
        <div className="space-y-2">
          <h4 className="text-sm font-bold text-slate-800">Orçamentos</h4>
          {plan.budgets.map((b) => (
            <div
              key={b.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3"
            >
              <div>
                <span className="font-medium text-slate-800">{b.title || 'Orçamento'}</span>
                <span className="ml-2 text-xs text-slate-500">{BUDGET_STATUS_LABEL[b.status]}</span>
                <span className="ml-2 text-xs text-slate-400">
                  {b.frozenTotalCents !== null ? `Total ${brl(b.frozenTotalCents)}` : ''}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <a
                  href={`/api/pacientes/${patientId}/plano/orcamentos/${b.id}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-slate-600 hover:underline"
                >
                  PDF
                </a>
                {canWrite && (b.status === 'proposto' || b.status === 'apresentado') ? (
                  <>
                    {b.status === 'proposto' ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          post(
                            `/api/pacientes/${patientId}/plano/orcamentos/${b.id}`,
                            { action: 'apresentar' },
                            'PATCH',
                          )
                        }
                        className="text-slate-600 hover:underline"
                      >
                        Apresentar
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        post(
                          `/api/pacientes/${patientId}/plano/orcamentos/${b.id}`,
                          { action: 'aceitar' },
                          'PATCH',
                        )
                      }
                      className="text-emerald-700 hover:underline"
                    >
                      Aceitar
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        post(
                          `/api/pacientes/${patientId}/plano/orcamentos/${b.id}`,
                          { action: 'recusar' },
                          'PATCH',
                        )
                      }
                      className="text-red-600 hover:underline"
                    >
                      Recusar
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-lg font-bold text-slate-900">{value}</div>
      {hint ? <div className="text-[11px] text-amber-600">{hint}</div> : null}
    </div>
  )
}
