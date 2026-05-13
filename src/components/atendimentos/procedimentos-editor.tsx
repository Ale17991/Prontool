'use client'

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  LocalProcedureTypeahead,
  type LocalProcedureOption,
} from '@/components/tuss/local-procedure-typeahead'
import { cn } from '@/lib/utils'

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
   * Plano default (do paciente) — usado quando uma linha nova é adicionada
   * e o procedimento é coberto por plano.
   */
  defaultPlanId: string | null
  disabled?: boolean
}

const PARTICULAR_SENTINEL = '__particular__'

/** Mantido para back-compat com chamadores externos. */
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
 * Editor de procedimentos em layout de planilha:
 *   - Topo: busca (typeahead). Selecionar adiciona linha + limpa busca.
 *   - Toggle global "Particular" muda todas as linhas para particular ou
 *     reverte ao plano do paciente em um clique.
 *   - Tabela abaixo: # | Código | Descrição | Plano | Valor | Ações (X).
 *     Plano e valor são editáveis inline; X remove a linha sem confirmação.
 *   - Total no rodapé.
 *
 * Auto-preenchimento de preço (sem mudança vs. versão card-based):
 *   - Particular: usa procedures[i].defaultAmountCents
 *   - Convênio: chama /api/precos/vigente?plan_id=...&procedure_id=...
 */
export function ProcedurasEditor({
  value,
  onChange,
  procedures,
  plans,
  defaultPlanId,
  disabled = false,
}: ProcedurasEditorProps) {
  const [globalParticular, setGlobalParticular] = useState(false)
  // Força remount do typeahead após cada pick (value="" + busca limpa).
  // Mais simples que controlar o estado interno do componente.
  const [pickerKey, setPickerKey] = useState(0)

  // Ref pra ter sempre a versão mais recente do array dentro de callbacks
  // assíncronos (resolveAndApplyPrice é async; sem a ref usaríamos closure
  // velho e sobrescreveríamos updates intermediários).
  const valueRef = useRef(value)
  useEffect(() => {
    valueRef.current = value
  }, [value])

  /** Aplica um patch a uma linha usando o valueRef (sempre fresco). */
  function patchLine(index: number, patch: Partial<ProcedureLineDraft>) {
    const current = valueRef.current
    const next = current.map((l, i) => (i === index ? { ...l, ...patch } : l))
    valueRef.current = next
    onChange(next)
  }

  function removeLine(index: number) {
    const next = valueRef.current.filter((_, i) => i !== index)
    valueRef.current = next
    onChange(next)
  }

  function clearAllLines() {
    valueRef.current = []
    onChange([])
  }

  /** Handler do typeahead: adiciona linha + limpa busca. */
  async function handlePickProcedure(procedureId: string) {
    if (!procedureId) return
    const proc = procedures.find((p) => p.id === procedureId)
    if (!proc) return
    const isUncovered = proc.coveredByPlan === false
    const initialPlanId: string | null =
      isUncovered || globalParticular ? null : defaultPlanId

    const newLine: ProcedureLineDraft = {
      procedureId,
      planId: initialPlanId,
      amountReais: '',
      vigenteAmountCents: null,
      particularLocked: isUncovered,
    }
    const next = [...valueRef.current, newLine]
    valueRef.current = next
    onChange(next)
    setPickerKey((k) => k + 1) // reseta o typeahead

    await resolveAndApplyPrice(next.length - 1, procedureId, initialPlanId)
  }

  /** Plano editado inline em uma linha. */
  async function handlePlanChange(index: number, newPlanId: string | null) {
    const current = valueRef.current[index]
    if (!current) return
    patchLine(index, {
      planId: newPlanId,
      amountReais: '',
      vigenteAmountCents: null,
    })
    if (current.procedureId) {
      await resolveAndApplyPrice(index, current.procedureId, newPlanId)
    }
  }

  /** Toggle global: alterna todas as linhas entre particular e plano do paciente. */
  async function handleGlobalParticularChange(nextValue: boolean) {
    setGlobalParticular(nextValue)
    const current = valueRef.current
    if (current.length === 0) return
    // Linhas com particularLocked sempre ficam particular; demais seguem o toggle.
    const targetForFree: string | null = nextValue ? null : defaultPlanId
    const updated = current.map((l) => {
      if (l.particularLocked) return l
      return {
        ...l,
        planId: targetForFree,
        amountReais: '',
        vigenteAmountCents: null,
      }
    })
    valueRef.current = updated
    onChange(updated)
    // Reprecifica em paralelo as linhas que mudaram.
    await Promise.all(
      updated.map(async (l, i) => {
        if (current[i] === l) return
        if (!l.procedureId) return
        const pid = l.planId === null ? null : (l.planId as string)
        await resolveAndApplyPrice(i, l.procedureId, pid)
      }),
    )
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
      }
      return
    }

    try {
      const params = new URLSearchParams({ plan_id: planId, procedure_id: procedureId })
      const res = await fetch(`/api/precos/vigente?${params.toString()}`)
      if (!res.ok) {
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
      // best-effort; usuário pode digitar manualmente.
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label className="text-sm font-bold text-slate-700">
          Procedimentos ({value.length})
        </Label>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
            <input
              type="checkbox"
              checked={globalParticular}
              disabled={disabled}
              onChange={(e) => void handleGlobalParticularChange(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            Particular (todas as linhas)
          </label>
          {value.length > 0 ? (
            <button
              type="button"
              onClick={clearAllLines}
              disabled={disabled}
              className="text-[11px] font-semibold text-slate-500 hover:text-rose-600"
            >
              Limpar todos
            </button>
          ) : null}
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="proc_picker" className="text-[11px] text-slate-600">
          Adicionar procedimento (código ou nome)
        </Label>
        <LocalProcedureTypeahead
          key={pickerKey}
          id="proc_picker"
          options={procedures}
          value=""
          onChange={(id) => void handlePickProcedure(id)}
          placeholder="Buscar e clicar para adicionar…"
        />
        <p className="text-[11px] text-slate-500">
          Selecione um procedimento — ele é adicionado à tabela e os campos são limpos
          para o próximo.
        </p>
      </div>

      {value.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-xs text-slate-500">
          Nenhum procedimento adicionado. Use a busca acima.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead className="w-32">Código</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead className="w-48">Plano</TableHead>
                <TableHead className="w-32 text-right">Valor (R$)</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {value.map((line, i) => {
                const proc = procedures.find((p) => p.id === line.procedureId)
                const codeText = proc
                  ? typeof proc.tussCode === 'string' && proc.tussCode.trim().length > 0
                    ? proc.tussCode
                    : proc.isUnlisted
                      ? 'Não listado'
                      : '—'
                  : '—'
                const description = proc?.displayName ?? '(sem nome)'
                const planSelectValue =
                  line.planId === null
                    ? PARTICULAR_SENTINEL
                    : line.planId === ''
                      ? ''
                      : (line.planId as string)
                return (
                  <TableRow key={i} className="align-middle">
                    <TableCell className="font-mono text-xs text-slate-500 tabular-nums">
                      {i + 1}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {proc?.isCustomCoded ? (
                          <span className="rounded border border-violet-200 bg-violet-50 px-1 py-0.5 text-[9px] font-bold uppercase tracking-widest text-violet-700">
                            Pers.
                          </span>
                        ) : proc?.isUnlisted ? (
                          <span className="rounded border border-amber-200 bg-amber-50 px-1 py-0.5 text-[9px] font-bold uppercase tracking-widest text-amber-700">
                            Não list.
                          </span>
                        ) : null}
                        <span className="font-mono text-[11px] font-bold text-slate-900">
                          {codeText}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-slate-700">
                      <p className="line-clamp-2 whitespace-normal break-words">
                        {description}
                      </p>
                    </TableCell>
                    <TableCell>
                      {line.particularLocked ? (
                        <span
                          title="Procedimento não coberto pelo plano — sempre particular"
                          className="inline-flex items-center gap-1 text-[11px] text-amber-700"
                        >
                          Particular
                          <span className="text-[10px] text-amber-600">(não coberto)</span>
                        </span>
                      ) : (
                        <Select
                          value={planSelectValue}
                          onValueChange={(v) =>
                            void handlePlanChange(i, v === PARTICULAR_SENTINEL ? null : v)
                          }
                          disabled={disabled}
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue placeholder="Selecione…" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={PARTICULAR_SENTINEL}>Particular</SelectItem>
                            {plans.map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </TableCell>
                    <TableCell>
                      <Input
                        inputMode="decimal"
                        placeholder="0,00"
                        value={line.amountReais}
                        onChange={(e) =>
                          patchLine(i, { amountReais: e.target.value })
                        }
                        disabled={disabled}
                        className={cn('h-8 text-right tabular-nums')}
                      />
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => removeLine(i)}
                        disabled={disabled}
                        className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        title="Remover procedimento"
                        aria-label="Remover procedimento"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </TableCell>
                  </TableRow>
                )
              })}
              <TableRow className="bg-slate-50/50">
                <TableCell
                  colSpan={4}
                  className="text-right text-[11px] font-bold uppercase tracking-widest text-slate-500"
                >
                  Total
                </TableCell>
                <TableCell className="text-right font-black tabular-nums text-slate-900">
                  {formatCurrency(totalCents)}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

/**
 * Converte o texto "350,00" / "1.250,00" / "350" para cents (integer).
 * Retorna 0 quando vazio ou invalido.
 */
export function amountReaisToCents(raw: string): number {
  if (!raw || raw.trim().length === 0) return 0
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
 *   - procedureId obrigatório
 *   - se não-particular: planId obrigatório
 *   - valor em cents deve ser > 0
 *
 * Retorna null quando alguma linha está inválida OU a lista é vazia.
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
