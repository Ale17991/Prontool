'use client'

import { useEffect, useRef, useState } from 'react'
import { Minus, Plus, X } from 'lucide-react'
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
  /** Texto digitado em reais (ex: "350,00") — valor UNITARIO. String para edicao livre. */
  amountReais: string
  /** Valor vigente sugerido (em cents) — referencia interna para flag de override. */
  vigenteAmountCents: number | null
  /** Quando o procedimento nao e coberto pelo plano: trava particular nesta linha. */
  particularLocked: boolean
  /** Observação opcional por linha (até 500 chars). */
  notes: string
  /** Quantidade (default 1). Subtotal da linha = unitario * quantidade. */
  quantity: number
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
    notes: '',
    quantity: 1,
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
  // Procedimento selecionado no typeahead mas ainda NÃO adicionado à tabela.
  // O usuário confirma a adição clicando no botão "+" verde.
  const [pendingProcedureId, setPendingProcedureId] = useState('')
  // "Coberto pelo plano" sticky entre adds. Default = true se paciente tem
  // plano; falso se patient é particular. Usuário pode toggar para forçar
  // a próxima linha como particular (quando o paciente tem plano mas este
  // procedimento específico é fora do plano por opção).
  const [pendingCovered, setPendingCovered] = useState(defaultPlanId !== null)
  // Observação textual a ser anexada à próxima linha. Limpa após adicionar.
  const [pendingNotes, setPendingNotes] = useState('')
  // Força remount do typeahead após adicionar (zera o `search` interno do
  // popover, que o componente não expõe pra reset externo).
  const [pickerKey, setPickerKey] = useState(0)

  // Quando o paciente muda e ele deixa de ter plano: força covered=false
  // (não tem o que cobrir). Quando volta a ter plano: re-ativa covered=true
  // (assume intenção mais comum). Sem este sync a checkbox poderia ficar
  // marcada mas sem efeito útil.
  useEffect(() => {
    setPendingCovered(defaultPlanId !== null)
  }, [defaultPlanId])

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

  /**
   * Confirma a adição do procedimento atualmente pendente no typeahead.
   * Disparado pelo botão "+" verde. Limpa o pendente + remonta o typeahead
   * para zerar a busca. A linha herda o estado de "coberto pelo plano" e
   * a observação do formulário de busca.
   */
  async function handleAddPending() {
    const procedureId = pendingProcedureId
    if (!procedureId) return
    const proc = procedures.find((p) => p.id === procedureId)
    if (!proc) return
    const isUncovered = proc.coveredByPlan === false
    // Particular sempre quando: procedimento não coberto / toggle global
    // ativo / checkbox "coberto" desmarcado / paciente sem plano.
    const usePatientPlan = !isUncovered && !globalParticular && pendingCovered
    const initialPlanId: string | null =
      usePatientPlan && defaultPlanId ? defaultPlanId : null

    const newLine: ProcedureLineDraft = {
      procedureId,
      planId: initialPlanId,
      amountReais: '',
      vigenteAmountCents: null,
      particularLocked: isUncovered,
      notes: pendingNotes.trim(),
      quantity: 1,
    }
    const next = [...valueRef.current, newLine]
    valueRef.current = next
    onChange(next)

    setPendingProcedureId('')
    setPendingNotes('')
    setPickerKey((k) => k + 1)

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

  // Subtotal por linha = unitario * quantidade. Total geral = soma dos
  // subtotais (line_amount_cents continua sendo UNITARIO no payload — a
  // multiplicacao acontece aqui pra exibicao e na RPC pra persistir
  // appointments.frozen_amount_cents).
  const totalCents = value.reduce(
    (acc, l) => acc + amountReaisToCents(l.amountReais) * Math.max(1, l.quantity),
    0,
  )

  function adjustQuantity(index: number, delta: number) {
    const current = valueRef.current[index]
    if (!current) return
    const next = Math.max(1, (current.quantity || 1) + delta)
    patchLine(index, { quantity: next })
  }

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
              className="text-[11px] font-semibold text-slate-500 hover:text-destructive"
            >
              Limpar todos
            </button>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="proc_picker" className="text-[11px] text-slate-600">
          Adicionar procedimento (código ou nome)
        </Label>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <LocalProcedureTypeahead
              key={pickerKey}
              id="proc_picker"
              options={procedures}
              value={pendingProcedureId}
              onChange={setPendingProcedureId}
              placeholder="Buscar por código ou nome…"
            />
          </div>
          <Button
            type="button"
            onClick={() => void handleAddPending()}
            disabled={disabled || !pendingProcedureId}
            title="Adicionar procedimento selecionado"
            aria-label="Adicionar procedimento"
            className="h-9 shrink-0 gap-1 bg-emerald-600 px-3 text-white hover:bg-emerald-700 disabled:bg-emerald-300"
          >
            <Plus className="h-4 w-4" />
            Adicionar
          </Button>
        </div>

        <div className="flex flex-wrap items-start gap-3">
          <label
            className={cn(
              'flex items-center gap-1.5 text-xs font-medium',
              defaultPlanId === null
                ? 'cursor-not-allowed text-slate-400'
                : 'cursor-pointer text-slate-700',
            )}
            title={
              defaultPlanId === null
                ? 'Paciente sem plano cadastrado — todas as linhas são particulares.'
                : 'Quando marcado, a próxima linha usa o plano do paciente.'
            }
          >
            <input
              type="checkbox"
              checked={pendingCovered && defaultPlanId !== null}
              disabled={disabled || defaultPlanId === null}
              onChange={(e) => setPendingCovered(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            Coberto pelo plano
          </label>
          <div className="min-w-0 flex-1 space-y-1">
            <Label htmlFor="proc_notes" className="text-[10px] uppercase text-slate-500">
              Observação (opcional)
            </Label>
            <Input
              id="proc_notes"
              value={pendingNotes}
              onChange={(e) => setPendingNotes(e.target.value)}
              disabled={disabled}
              maxLength={500}
              placeholder="Anotação específica deste procedimento (até 500 caracteres)"
              className="h-8"
            />
          </div>
        </div>

        <p className="text-[11px] text-slate-500">
          Selecione um procedimento e clique em <span className="font-semibold">Adicionar</span>.
          O plano e a observação aplicam-se à próxima linha adicionada (sticky para o
          plano; observação é zerada após cada inclusão).
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
                <TableHead className="w-28 text-center">Qtd</TableHead>
                <TableHead className="w-48">Plano</TableHead>
                <TableHead className="w-32 text-right">Valor unit. (R$)</TableHead>
                <TableHead className="w-32 text-right">Subtotal</TableHead>
                <TableHead className="min-w-[12rem]">Observação</TableHead>
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
                          <span className="rounded border border-[#DDD6FE] bg-[#EDE9FE] px-1 py-0.5 text-[9px] font-bold uppercase tracking-widest text-[#5B21B6]">
                            Pers.
                          </span>
                        ) : proc?.isUnlisted ? (
                          <span className="rounded border border-[#E9D5FF] bg-[#FAF5FF] px-1 py-0.5 text-[9px] font-bold uppercase tracking-widest text-[#6B21A8]">
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
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => adjustQuantity(i, -1)}
                          disabled={disabled || (line.quantity || 1) <= 1}
                          className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                          title="Diminuir quantidade"
                          aria-label="Diminuir quantidade"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <Input
                          type="number"
                          min={1}
                          max={999}
                          step={1}
                          value={String(line.quantity || 1)}
                          onChange={(e) => {
                            const n = parseInt(e.target.value, 10)
                            patchLine(i, {
                              quantity: Number.isFinite(n) && n >= 1 ? Math.min(999, n) : 1,
                            })
                          }}
                          disabled={disabled}
                          className="h-7 w-12 px-1 text-center tabular-nums"
                          aria-label="Quantidade"
                        />
                        <button
                          type="button"
                          onClick={() => adjustQuantity(i, +1)}
                          disabled={disabled || (line.quantity || 1) >= 999}
                          className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                          title="Aumentar quantidade"
                          aria-label="Aumentar quantidade"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                    </TableCell>
                    <TableCell>
                      {line.particularLocked ? (
                        <span
                          title="Procedimento não coberto pelo plano — sempre particular"
                          className="inline-flex items-center gap-1 text-[11px] text-[hsl(var(--warning-foreground))]"
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
                    <TableCell className="text-right font-bold tabular-nums text-slate-900">
                      {formatCurrency(
                        amountReaisToCents(line.amountReais) * Math.max(1, line.quantity),
                      )}
                    </TableCell>
                    <TableCell>
                      <Input
                        value={line.notes}
                        onChange={(e) => patchLine(i, { notes: e.target.value })}
                        disabled={disabled}
                        maxLength={500}
                        placeholder="—"
                        className="h-8 text-xs"
                      />
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => removeLine(i)}
                        disabled={disabled}
                        className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-destructive/10 hover:text-destructive"
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
                  colSpan={6}
                  className="text-right text-[11px] font-bold uppercase tracking-widest text-slate-500"
                >
                  Total
                </TableCell>
                <TableCell className="text-right font-black tabular-nums text-slate-900">
                  {formatCurrency(totalCents)}
                </TableCell>
                <TableCell colSpan={2} />
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
  /** Valor UNITARIO em cents (>0). Total da linha = amountCentsOverride * quantity. */
  amountCentsOverride: number
  notes: string | null
  /** Inteiro >= 1. Default 1 quando o draft nao tem campo (compat). */
  quantity: number
}

/**
 * Valida e converte as linhas para o payload do POST.
 *
 * Regras:
 *   - procedureId obrigatório
 *   - se não-particular: planId obrigatório
 *   - valor unitário em cents deve ser > 0
 *   - quantity inteiro >= 1 (default 1)
 *   - notes opcional (trim aplicado; vazio vira null)
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
    // Permite valor zero (consulta/procedimento gratuito).
    if (cents < 0) return null
    const notesTrimmed = (l.notes ?? '').trim()
    if (notesTrimmed.length > 500) return null
    const qty = Number.isInteger(l.quantity) && l.quantity >= 1 ? l.quantity : 1
    out.push({
      procedureId: l.procedureId,
      planId: l.planId === null ? null : (l.planId as string),
      amountCentsOverride: cents,
      notes: notesTrimmed.length > 0 ? notesTrimmed : null,
      quantity: qty,
    })
  }
  return out
}
