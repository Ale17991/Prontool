'use client'

import Link from 'next/link'
import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  Check,
  DollarSign,
  Loader2,
  Pencil,
  Plus,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn, formatCurrency, formatDate } from '@/lib/utils'

export interface ProcedureOption {
  id: string
  tussCode: string
  displayName: string | null
}

export interface PriceHeadWithProcedure {
  priceVersionId: string
  procedureId: string
  tussCode: string
  displayName: string | null
  amountCents: number
  validFrom: string
  procedureActive: boolean
  procedureCovered: boolean
}

interface Props {
  planId: string
  planName: string
  initialHeads: PriceHeadWithProcedure[]
  procedures: ProcedureOption[]
  canWrite: boolean
}

export function PlanProceduresSection({
  planId,
  planName,
  initialHeads,
  procedures,
  canWrite,
}: Props) {
  const router = useRouter()
  const [heads, setHeads] = useState<PriceHeadWithProcedure[]>(initialHeads)
  const [showAdd, setShowAdd] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const pricedProcedureIds = new Set(heads.map((h) => h.procedureId))
  const addableProcedures = procedures.filter((p) => !pricedProcedureIds.has(p.id))

  function onAdded(newHead: PriceHeadWithProcedure) {
    setHeads((prev) =>
      [newHead, ...prev.filter((h) => h.procedureId !== newHead.procedureId)].sort(
        (a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? ''),
      ),
    )
    setShowAdd(false)
    startTransition(() => router.refresh())
  }

  function onChanged(newHead: PriceHeadWithProcedure) {
    setHeads((prev) =>
      prev.map((h) => (h.procedureId === newHead.procedureId ? newHead : h)),
    )
    setEditingId(null)
    startTransition(() => router.refresh())
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <DollarSign className="h-4 w-4 text-primary" />
          Procedimentos cobertos ({heads.length})
        </CardTitle>
        {canWrite ? (
          <Button
            size="sm"
            variant={showAdd ? 'outline' : 'default'}
            onClick={() => setShowAdd((v) => !v)}
            className="gap-1.5"
          >
            {showAdd ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {showAdd ? 'Cancelar' : 'Adicionar procedimento'}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {showAdd && canWrite ? (
          addableProcedures.length === 0 ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
              Todos os procedimentos cobertos já têm preço neste convênio.{' '}
              <Link href="/cadastros/procedimentos" className="underline">
                Cadastrar novo procedimento
              </Link>
            </div>
          ) : (
            <AddProcedureForm
              planId={planId}
              procedures={addableProcedures}
              onAdded={onAdded}
            />
          )
        ) : null}

        {heads.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">
            Nenhum procedimento com preço cadastrado em {planName} ainda.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>TUSS</TableHead>
                <TableHead>Procedimento</TableHead>
                <TableHead>Valor (R$)</TableHead>
                <TableHead>Vigente desde</TableHead>
                <TableHead>Status</TableHead>
                {canWrite ? <TableHead className="text-right">Ações</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {heads.map((h) => (
                <Row
                  key={h.procedureId}
                  head={h}
                  planId={planId}
                  canWrite={canWrite}
                  editing={editingId === h.procedureId}
                  onEditStart={() => setEditingId(h.procedureId)}
                  onEditCancel={() => setEditingId(null)}
                  onChanged={onChanged}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

function Row({
  head,
  planId,
  canWrite,
  editing,
  onEditStart,
  onEditCancel,
  onChanged,
}: {
  head: PriceHeadWithProcedure
  planId: string
  canWrite: boolean
  editing: boolean
  onEditStart: () => void
  onEditCancel: () => void
  onChanged: (next: PriceHeadWithProcedure) => void
}) {
  return (
    <>
      <TableRow>
        <TableCell className="font-mono text-xs font-bold text-primary">{head.tussCode}</TableCell>
        <TableCell>
          <p className="font-semibold text-slate-900">{head.displayName ?? '—'}</p>
        </TableCell>
        <TableCell className="font-black text-slate-900 tabular-nums">
          {formatCurrency(head.amountCents)}
        </TableCell>
        <TableCell className="text-slate-700">{formatDate(head.validFrom)}</TableCell>
        <TableCell>
          {!head.procedureActive ? (
            <Badge variant="secondary">Procedimento inativo</Badge>
          ) : !head.procedureCovered ? (
            <Badge variant="outline" className="border-amber-300 text-amber-700">
              Agora particular
            </Badge>
          ) : (
            <Badge variant="success">Vigente</Badge>
          )}
        </TableCell>
        {canWrite ? (
          <TableCell className="text-right">
            {!editing ? (
              <button
                type="button"
                onClick={onEditStart}
                className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"
              >
                <Pencil className="h-3 w-3" /> Alterar valor
              </button>
            ) : null}
          </TableCell>
        ) : null}
      </TableRow>
      {editing ? (
        <TableRow className="bg-slate-50/50">
          <TableCell colSpan={canWrite ? 6 : 5}>
            <AlterPriceForm
              head={head}
              planId={planId}
              onDone={onChanged}
              onCancel={onEditCancel}
            />
          </TableCell>
        </TableRow>
      ) : null}
    </>
  )
}

function AddProcedureForm({
  planId,
  procedures,
  onAdded,
}: {
  planId: string
  procedures: ProcedureOption[]
  onAdded: (next: PriceHeadWithProcedure) => void
}) {
  const [search, setSearch] = useState('')
  const [procedureId, setProcedureId] = useState('')
  const [amount, setAmount] = useState('')
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10))
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filtered = search.trim().length === 0
    ? procedures.slice(0, 50)
    : procedures
        .filter((p) => {
          const q = search.toLowerCase()
          return (
            p.tussCode.toLowerCase().includes(q) ||
            (p.displayName ?? '').toLowerCase().includes(q)
          )
        })
        .slice(0, 50)

  const selectedProcedure = procedures.find((p) => p.id === procedureId) ?? null

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!procedureId) {
      setError('Selecione o procedimento.')
      return
    }
    const amountCents = toCents(amount)
    if (amountCents === null) {
      setError('Informe um valor válido (ex.: 250,00).')
      return
    }
    if (reason.trim().length < 3) {
      setError('Motivo precisa ter pelo menos 3 caracteres.')
      return
    }

    setPending(true)
    try {
      const res = await fetch('/api/precos/versions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          procedure_id: procedureId,
          plan_id: planId,
          amount_cents: amountCents,
          valid_from: validFrom,
          reason: reason.trim(),
          expected_head_id: null,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
          message?: string
        }
        setError(body.error?.message ?? body.message ?? `HTTP ${res.status}`)
        return
      }
      const created = (await res.json()) as {
        id: string
        amount_cents: number
        valid_from: string
      }
      if (selectedProcedure) {
        onAdded({
          priceVersionId: created.id,
          procedureId: selectedProcedure.id,
          tussCode: selectedProcedure.tussCode,
          displayName: selectedProcedure.displayName,
          amountCents: created.amount_cents,
          validFrom: created.valid_from,
          procedureActive: true,
          procedureCovered: true,
        })
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50/50 p-4 md:grid-cols-2"
    >
      <div className="space-y-1.5 md:col-span-2">
        <Label htmlFor="add_search">Procedimento</Label>
        <Input
          id="add_search"
          placeholder="Buscar por TUSS ou nome…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="max-h-40 overflow-y-auto rounded-md border border-slate-200 bg-white text-xs">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-slate-400">
              Nenhum procedimento encontrado (só listamos os cobertos por plano sem preço neste convênio).
            </p>
          ) : (
            filtered.map((p) => (
              <button
                type="button"
                key={p.id}
                onClick={() => setProcedureId(p.id)}
                className={cn(
                  'flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-slate-50',
                  p.id === procedureId ? 'bg-slate-50 font-bold text-primary' : 'text-slate-600',
                )}
              >
                <span className="truncate">{p.displayName ?? '(sem nome)'}</span>
                <span className="ml-2 font-mono text-[10px] text-slate-500">{p.tussCode}</span>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="add_amount">Valor (R$)</Label>
        <Input
          id="add_amount"
          required
          inputMode="decimal"
          placeholder="250,00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="add_valid_from">Vigente desde</Label>
        <Input
          id="add_valid_from"
          required
          type="date"
          value={validFrom}
          onChange={(e) => setValidFrom(e.target.value)}
        />
      </div>

      <div className="space-y-1.5 md:col-span-2">
        <Label htmlFor="add_reason">Motivo</Label>
        <Textarea
          id="add_reason"
          required
          minLength={3}
          placeholder="Ex.: Inclusão do procedimento na tabela do convênio."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="min-h-[64px]"
        />
      </div>

      {error ? (
        <div className="md:col-span-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="md:col-span-2 flex justify-end">
        <Button type="submit" size="sm" disabled={pending} className="gap-2">
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Adicionar procedimento
        </Button>
      </div>
    </form>
  )
}

function AlterPriceForm({
  head,
  planId,
  onDone,
  onCancel,
}: {
  head: PriceHeadWithProcedure
  planId: string
  onDone: (next: PriceHeadWithProcedure) => void
  onCancel: () => void
}) {
  const [amount, setAmount] = useState(
    (head.amountCents / 100).toFixed(2).replace('.', ','),
  )
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10))
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    const amountCents = toCents(amount)
    if (amountCents === null) {
      setError('Informe um valor válido (ex.: 250,00).')
      return
    }
    if (reason.trim().length < 3) {
      setError('Motivo precisa ter pelo menos 3 caracteres.')
      return
    }

    setPending(true)
    try {
      const res = await fetch('/api/precos/versions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          procedure_id: head.procedureId,
          plan_id: planId,
          amount_cents: amountCents,
          valid_from: validFrom,
          reason: reason.trim(),
          expected_head_id: head.priceVersionId,
        }),
      })
      if (res.status === 409) {
        const body = (await res.json().catch(() => ({}))) as {
          current_head_id?: string | null
        }
        setError(
          body.current_head_id
            ? 'Outro admin alterou o preço enquanto você editava. Recarregue a página.'
            : 'Conflito de concorrência — recarregue e tente de novo.',
        )
        return
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
          message?: string
        }
        setError(body.error?.message ?? body.message ?? `HTTP ${res.status}`)
        return
      }
      const created = (await res.json()) as {
        id: string
        amount_cents: number
        valid_from: string
      }
      onDone({
        ...head,
        priceVersionId: created.id,
        amountCents: created.amount_cents,
        validFrom: created.valid_from,
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-3"
    >
      <div className="space-y-1.5">
        <Label htmlFor={`alt_amount_${head.procedureId}`}>Novo valor (R$)</Label>
        <Input
          id={`alt_amount_${head.procedureId}`}
          required
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`alt_from_${head.procedureId}`}>Vigente desde</Label>
        <Input
          id={`alt_from_${head.procedureId}`}
          required
          type="date"
          value={validFrom}
          onChange={(e) => setValidFrom(e.target.value)}
        />
      </div>
      <div className="flex items-end justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" size="sm" disabled={pending} className="gap-2">
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Salvar
        </Button>
      </div>
      <div className="space-y-1.5 md:col-span-3">
        <Label htmlFor={`alt_reason_${head.procedureId}`}>Motivo</Label>
        <Textarea
          id={`alt_reason_${head.procedureId}`}
          required
          minLength={3}
          placeholder="Ex.: Reajuste anual de 8% negociado com a operadora."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="min-h-[56px]"
        />
      </div>
      {error ? (
        <div className="md:col-span-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
          {error}
        </div>
      ) : null}
    </form>
  )
}

function toCents(input: string): number | null {
  const cleaned = input.trim().replace(/\./g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const value = Number(cleaned)
  if (Number.isNaN(value) || value < 0) return null
  return Math.round(value * 100)
}
