'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ChevronDown, Loader2, Plus, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import type { ReceivableRow, ReceivableStatus } from '@/lib/core/accounts-receivable'

const STATUS_LABEL: Record<ReceivableStatus, string> = {
  pendente: 'Pendente',
  atrasado: 'Atrasada',
  parcial: 'Parcial',
  inadimplencia: 'Inadimplência',
}

const STATUS_CLASS: Record<ReceivableStatus, string> = {
  pendente: 'bg-info-bg text-info-text',
  atrasado: 'bg-[hsl(var(--warning)/0.2)] text-[hsl(var(--warning-foreground))]',
  parcial: 'bg-info-bg text-info-text',
  inadimplencia: 'bg-[hsl(var(--alert)/0.15)] text-[hsl(var(--alert))]',
}

interface Props {
  rows: ReceivableRow[]
  canMarkBadDebt: boolean
  canReversePayment: boolean
}

export function ReceivablesTable({ rows, canMarkBadDebt }: Props) {
  const router = useRouter()
  const [payingId, setPayingId] = useState<string | null>(null)

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 py-10 text-center">
        <p className="text-sm text-slate-500">Nenhuma parcela pendente.</p>
      </div>
    )
  }

  return (
    <>
      <div className="overflow-x-auto rounded-md border border-slate-200">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-[10px] uppercase tracking-widest">Paciente</TableHead>
              <TableHead className="text-[10px] uppercase tracking-widest">Vencimento</TableHead>
              <TableHead className="text-[10px] uppercase tracking-widest">Valor</TableHead>
              <TableHead className="text-[10px] uppercase tracking-widest">Pendente</TableHead>
              <TableHead className="text-[10px] uppercase tracking-widest">Status</TableHead>
              <TableHead className="text-[10px] uppercase tracking-widest">Dias</TableHead>
              <TableHead className="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const isCritical = r.daysOverdue > 60
              return (
                <TableRow key={r.installmentId}>
                  <TableCell className="text-xs">
                    {r.patientIsAnonymized ? (
                      <span className="italic text-slate-400">[anonimizado]</span>
                    ) : (
                      (r.patientName ?? r.patientId?.slice(0, 8) ?? '—')
                    )}
                    {r.installmentNumber > 1 ? (
                      <span className="ml-1 text-[10px] text-slate-400">
                        #{r.installmentNumber}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-[11px]">
                    {formatDate(r.dueDate)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {formatCurrency(r.amountCents)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs font-bold">
                    {formatCurrency(r.pendingAmountCents)}
                    {r.paymentsCount > 0 ? (
                      <span className="ml-1 text-[9px] text-slate-400">
                        ({r.paymentsCount} pag.)
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={cn('h-5 px-1.5 text-[10px]', STATUS_CLASS[r.status])}
                    >
                      {STATUS_LABEL[r.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {r.daysOverdue > 0 ? (
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 text-[11px] font-bold',
                          isCritical ? 'text-destructive' : 'text-warning',
                        )}
                      >
                        {isCritical ? <AlertTriangle className="h-3 w-3" /> : null}
                        {r.daysOverdue}d
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-400">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => setPayingId(r.installmentId)}
                        disabled={r.pendingAmountCents <= 0}
                      >
                        <Plus className="mr-1 h-3 w-3" />
                        Pagar
                      </Button>
                      {canMarkBadDebt && isCritical ? (
                        <MarkBadDebtButton
                          installmentId={r.installmentId}
                          onDone={() => router.refresh()}
                        />
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {payingId ? (
        <RegisterPaymentModal
          row={rows.find((r) => r.installmentId === payingId)!}
          onClose={() => setPayingId(null)}
          onSuccess={() => {
            setPayingId(null)
            router.refresh()
          }}
        />
      ) : null}
    </>
  )
}

function MarkBadDebtButton({
  installmentId,
  onDone,
}: {
  installmentId: string
  onDone: () => void
}) {
  const [pending, setPending] = useState(false)
  async function handleClick() {
    if (!confirm('Marcar como inadimplência? Não exclui o registro.')) return
    setPending(true)
    try {
      await fetch(`/api/financeiro/contas-a-receber/${installmentId}/bad-debt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'Marcado via tela de contas a receber' }),
      })
      onDone()
    } finally {
      setPending(false)
    }
  }
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 px-2 text-[11px] text-destructive"
      onClick={() => void handleClick()}
      disabled={pending}
    >
      {pending ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <AlertTriangle className="h-3 w-3" />
      )}
    </Button>
  )
}

function RegisterPaymentModal({
  row,
  onClose,
  onSuccess,
}: {
  row: ReceivableRow
  onClose: () => void
  onSuccess: () => void
}) {
  const [amount, setAmount] = useState((row.pendingAmountCents / 100).toFixed(2))
  const [method, setMethod] = useState('pix')
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 16))
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const cents = Math.round(Number(amount.replace(',', '.')) * 100)
    if (!cents || cents <= 0) {
      setError('Valor inválido')
      return
    }
    if (cents > row.pendingAmountCents) {
      setError('Valor maior que pendente')
      return
    }
    setPending(true)
    try {
      const res = await fetch(`/api/financeiro/contas-a-receber/${row.installmentId}/payment`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          amount_cents: cents,
          payment_method: method,
          paid_at: new Date(paidAt).toISOString(),
          note: note.trim() || null,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        setError(body.error?.message ?? 'Falha ao registrar pagamento.')
        return
      }
      onSuccess()
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar pagamento</DialogTitle>
          <DialogDescription>
            Parcela vence em {formatDate(row.dueDate)} — {formatCurrency(row.pendingAmountCents)}{' '}
            pendente.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="amount">Valor (R$)</Label>
            <Input
              id="amount"
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0,00"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="method">Método</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger id="method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pix">PIX</SelectItem>
                <SelectItem value="dinheiro">Dinheiro</SelectItem>
                <SelectItem value="cartao_credito">Cartão de crédito</SelectItem>
                <SelectItem value="cartao_debito">Cartão de débito</SelectItem>
                <SelectItem value="boleto">Boleto</SelectItem>
                <SelectItem value="convenio">Convênio</SelectItem>
                <SelectItem value="outro">Outro</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="paid_at">Data/hora</Label>
            <Input
              id="paid_at"
              type="datetime-local"
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="note">Nota (opcional)</Label>
            <Textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="min-h-[60px]"
            />
          </div>
          {error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              <X className="mr-1 h-3 w-3" /> Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <ChevronDown className="mr-1 h-3 w-3 rotate-[-90deg]" />
              )}
              Salvar pagamento
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
