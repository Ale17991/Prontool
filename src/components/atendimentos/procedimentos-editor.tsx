'use client'

import { useEffect, useRef } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  LocalProcedureTypeahead,
  type LocalProcedureOption,
} from '@/components/tuss/local-procedure-typeahead'

export interface ProcedureLineDraft {
  procedureId: string
  /** null = linha particular. '' = ainda nao escolhido. */
  planId: string | null | ''
  /** Texto digitado em reais (ex: "350,00"). String para permitir edicao livre. */
  amountReais: string
  /** Valor vigente sugerido (em cents) — referencia interna para flag de override. */
  vigenteAmountCents: number | null
  /** Quando o procedimento nao e coberto pelo plano: trava particular nesta linha. */
  particularLocked: boolean
}

export interface PlanFormOption {
  id: string
  label: string
}

export interface ProcedurasEditorProps {
  value: ProcedureLineDraft[]
  onChange: (next: ProcedureLineDraft[]) => void
  procedures: LocalProcedureOption[]
  plans: PlanFormOption[]
  /**
   * Plano default (do paciente) — usado quando uma linha nova e adicionada
   * e o procedimento e coberto por plano.
   */
  defaultPlanId: string | null
  disabled?: boolean
}

export function createEmptyLine(defaultPlanId: string | null): ProcedureLineDraft {
  return {
    procedureId: '',
    planId: defaultPlanId,
    amountReais: '',
    vigenteAmountCents: null,
    particularLocked: false,
  }
}

/**
 * Editor de N procedimentos por atendimento. Cada linha contem:
 *   - typeahead de procedimento
 *   - checkbox "Particular" + select de plano (se aplicavel)
 *   - input de valor em R$ (preenchido automaticamente quando procedimento +
 *     plano estao definidos; pode ser sobrescrito)
 *   - botao de remover (exceto linha unica)
 *
 * Auto-preenchimento de preco:
 *   - Particular: usa procedures[i].defaultAmountCents
 *   - Convenio: chama /api/precos/vigente?plan_id=...&procedure_id=...
 *
 * Estado vive no parent (controlado). Validacao com `validateProcedures`.
 */
export function ProcedurasEditor({
  value,
  onChange,
  procedures,
  plans,
  defaultPlanId,
  disabled = false,
}: ProcedurasEditorProps) {
  // Ref pra ter sempre a versao MAIS RECENTE do array dentro de handlers async.
  // Sem isso, callbacks async usam o `value` capturado no closure e
  // sobrescrevem atualizacoes intermediarias (stale-state bug).
  const valueRef = useRef(value)
  useEffect(() => {
    valueRef.current = value
  }, [value])

  // Garante pelo menos uma linha.
  useEffect(() => {
    if (value.length === 0) {
      onChange([createEmptyLine(defaultPlanId)])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Aplica um patch a uma linha usando o valueRef (sempre fresco). */
  function patchLine(index: number, patch: Partial<ProcedureLineDraft>) {
    const current = valueRef.current
    const next = current.map((l, i) => (i === index ? { ...l, ...patch } : l))
    valueRef.current = next
    onChange(next)
  }

  function addLine() {
    const next = [...valueRef.current, createEmptyLine(defaultPlanId)]
    valueRef.current = next
    onChange(next)
  }

  function removeLine(index: number) {
    if (valueRef.current.length <= 1) return
    const next = valueRef.current.filter((_, i) => i !== index)
    valueRef.current = next
    onChange(next)
  }

  // Quando o procedimento muda: re-checa coverage, atualiza imediato + fetch
  // preco assincrono. Usar patchLine garante que cada update parte da versao
  // mais recente do array (sem race entre updates).
  async function handleProcedureChange(index: number, newProcedureId: string) {
    const proc = procedures.find((p) => p.id === newProcedureId) ?? null
    const isUncovered = proc?.coveredByPlan === false
    const currentLine = valueRef.current[index]
    if (!currentLine) return

    // Atualizacao imediata: marca procedimento, limpa valor antigo.
    patchLine(index, {
      procedureId: newProcedureId,
      particularLocked: isUncovered,
      planId: isUncovered ? null : currentLine.planId,
      amountReais: '',
      vigenteAmountCents: null,
    })

    const planForFetch =
      isUncovered
        ? null
        : currentLine.planId === '' || currentLine.planId === undefined
          ? null
          : currentLine.planId
    await resolveAndApplyPrice(index, newProcedureId, planForFetch)
  }

  async function handlePlanChange(index: number, newPlanId: string | null) {
    const current = valueRef.current[index]
    if (!current) return
    patchLine(index, { planId: newPlanId, amountReais: '', vigenteAmountCents: null })
    if (current.procedureId) {
      await resolveAndApplyPrice(index, current.procedureId, newPlanId)
    }
  }

  async function resolveAndApplyPrice(
    index: number,
    procedureId: string,
    planId: string | null,
  ) {
    if (!procedureId) return
    const proc = procedures.find((p) => p.id === procedureId)
    if (!proc) return

    if (planId === null) {
      const cents = proc.defaultAmountCents ?? null
      if (cents !== null && cents > 0) {
        applyVigente(index, cents)
      } else if (proc.isUnlisted) {
        // Unlisted sem valor padrao: deixa o usuario digitar manualmente.
      }
      return
    }

    try {
      const params = new URLSearchParams({ plan_id: planId, procedure_id: procedureId })
      const res = await fetch(`/api/precos/vigente?${params.toString()}`)
      if (!res.ok) {
        // Sem preco vigente cadastrado: cai pro default_amount_cents quando
        // o procedimento e unlisted (pacote sem price_version), ou deixa
        // vazio caso contrario.
        if (proc.isUnlisted && proc.defaultAmountCents) {
          applyVigente(index, proc.defaultAmountCents)
        }
        return
      }
      const body = (await res.json()) as { amountCents?: number | null }
      if (typeof body.amountCents === 'number' && body.amountCents > 0) {
        applyVigente(index, body.amountCents)
      } else if (proc.isUnlisted && proc.defaultAmountCents) {
        applyVigente(index, proc.defaultAmountCents)
      }
    } catch {
      // best-effort — deixa o usuario digitar manualmente.
    }
  }

  function applyVigente(index: number, cents: number) {
    patchLine(index, {
      vigenteAmountCents: cents,
      amountReais: (cents / 100).toFixed(2).replace('.', ','),
    })
  }

  const totalCents = value.reduce((acc, l) => acc + amountReaisToCents(l.amountReais), 0)

  return (
    <div className="md:col-span-2 space-y-3 rounded-md border border-slate-200 bg-slate-50/40 p-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-bold text-slate-700">
          Procedimentos ({value.length})
        </Label>
        <p className="text-[11px] text-slate-500">
          Total: <span className="font-bold tabular-nums">{formatCurrency(totalCents)}</span>
        </p>
      </div>

      <ul className="space-y-3">
        {value.map((line, i) => {
          const isParticular = line.planId === null
          return (
            <li
              key={i}
              className="space-y-2 rounded border border-slate-200 bg-white p-3 text-sm"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">
                  Procedimento {i + 1}
                </span>
                {value.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeLine(i)}
                    disabled={disabled}
                    className="h-7 w-7 p-0 text-slate-400 hover:text-red-600"
                    title="Remover procedimento"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </div>

              <div className="grid grid-cols-1 gap-2 md:grid-cols-12">
                <div className="space-y-1 md:col-span-7">
                  <Label htmlFor={`proc_${i}`} className="text-[11px] text-slate-600">
                    TUSS
                  </Label>
                  <LocalProcedureTypeahead
                    id={`proc_${i}`}
                    options={procedures}
                    value={line.procedureId}
                    onChange={(id) => handleProcedureChange(i, id)}
                  />
                </div>

                <div className="space-y-1 md:col-span-3">
                  <Label htmlFor={`plan_${i}`} className="text-[11px] text-slate-600">
                    Plano
                  </Label>
                  <label className="flex items-center gap-1.5 text-[11px] text-amber-900">
                    <input
                      type="checkbox"
                      checked={isParticular}
                      disabled={disabled || line.particularLocked}
                      onChange={(e) =>
                        handlePlanChange(i, e.target.checked ? null : defaultPlanId)
                      }
                      className="h-3.5 w-3.5"
                    />
                    Particular
                    {line.particularLocked ? (
                      <span className="text-amber-700">(não coberto)</span>
                    ) : null}
                  </label>
                  {!isParticular ? (
                    <Select
                      value={line.planId ?? ''}
                      onValueChange={(v) => handlePlanChange(i, v || null)}
                      disabled={disabled}
                    >
                      <SelectTrigger id={`plan_${i}`} className="h-8">
                        <SelectValue placeholder="Selecione…" />
                      </SelectTrigger>
                      <SelectContent>
                        {plans.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}
                </div>

                <div className="space-y-1 md:col-span-2">
                  <Label htmlFor={`amount_${i}`} className="text-[11px] text-slate-600">
                    Valor (R$)
                  </Label>
                  <Input
                    id={`amount_${i}`}
                    inputMode="decimal"
                    placeholder="0,00"
                    value={line.amountReais}
                    onChange={(e) => patchLine(i, { amountReais: e.target.value })}
                    disabled={disabled}
                    className="h-8"
                  />
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addLine}
          disabled={disabled}
          className="gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" />
          Adicionar procedimento
        </Button>
      </div>
    </div>
  )
}

/**
 * Converte o texto "350,00" / "1.250,00" / "350" para cents (integer).
 * Retorna 0 quando vazio ou invalido.
 */
export function amountReaisToCents(raw: string): number {
  if (!raw || raw.trim().length === 0) return 0
  // Remove separadores de milhar (.) e troca a virgula decimal por ponto.
  const normalized = raw.trim().replace(/\./g, '').replace(',', '.')
  const n = Number(normalized)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.round(n * 100)
}

function formatCurrency(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

export interface ValidatedProcedureLine {
  procedureId: string
  planId: string | null
  amountCentsOverride: number
}

/**
 * Valida e converte as linhas para o payload do POST.
 *
 * Regras:
 *   - procedureId obrigatorio
 *   - se nao-particular: planId obrigatorio
 *   - valor em cents deve ser > 0
 *
 * Retorna null quando alguma linha esta invalida.
 */
export function validateProcedures(
  lines: ProcedureLineDraft[],
): ValidatedProcedureLine[] | null {
  if (lines.length === 0) return null
  const out: ValidatedProcedureLine[] = []
  for (const l of lines) {
    if (!l.procedureId) return null
    if (l.planId !== null && (l.planId === '' || !l.planId)) return null
    const cents = amountReaisToCents(l.amountReais)
    if (cents <= 0) return null
    out.push({
      procedureId: l.procedureId,
      planId: l.planId === null ? null : (l.planId as string),
      amountCentsOverride: cents,
    })
  }
  return out
}
