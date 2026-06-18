'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2, Lock, Unlock, X } from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatCurrency } from '@/lib/utils'
import type {
  MonthlyPayoutLine,
  MonthlyPayoutSnapshot,
} from '@/lib/core/monthly-payouts'

interface Props {
  month: string
  snapshot: MonthlyPayoutSnapshot
  canCloseMonth: boolean
  canReopenMonth: boolean
  canReopenReason: string | null
  canMarkPaid: boolean
  isOwnViewOnly: boolean
}

export function PayoutsView({
  month,
  snapshot,
  canCloseMonth,
  canReopenMonth,
  canReopenReason,
  canMarkPaid,
  isOwnViewOnly,
}: Props) {
  const router = useRouter()
  const [closing, setClosing] = useState(false)
  const [reopening, setReopening] = useState(false)
  const [markingPayout, setMarkingPayout] = useState<MonthlyPayoutLine | null>(null)
  const [showReopenModal, setShowReopenModal] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClose() {
    if (!confirm(`Fechar o mês ${month}? Valores ficarão imutáveis.`)) return
    setError(null)
    setClosing(true)
    try {
      const res = await fetch(
        `/api/financeiro/repasse-medico/${month}/close`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      )
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        setError(body.error?.message ?? 'Falha ao fechar.')
        return
      }
      router.refresh()
    } finally {
      setClosing(false)
    }
  }

  return (
    <>
      {snapshot.payouts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 py-10 text-center">
          <p className="text-sm text-slate-500">
            Nenhum repasse a calcular para este mês.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-slate-200">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px] uppercase tracking-widest">
                  Médico
                </TableHead>
                <TableHead className="text-[10px] uppercase tracking-widest">
                  Bruto
                </TableHead>
                <TableHead className="text-[10px] uppercase tracking-widest">
                  Comissão
                </TableHead>
                <TableHead className="text-[10px] uppercase tracking-widest">
                  Fixo
                </TableHead>
                <TableHead className="text-[10px] uppercase tracking-widest">
                  Liberal
                </TableHead>
                <TableHead className="text-[10px] uppercase tracking-widest">
                  Ajustes
                </TableHead>
                <TableHead className="text-[10px] uppercase tracking-widest">
                  Total
                </TableHead>
                <TableHead className="text-[10px] uppercase tracking-widest">
                  Status
                </TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {snapshot.payouts.map((p) => (
                <TableRow key={p.doctorId}>
                  <TableCell className="text-xs font-semibold">
                    {p.doctorName}
                    {p.revenueByPlan.length > 0 ? (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-[10px] font-medium text-slate-400 hover:text-slate-600">
                          {p.revenueByPlan.length} convênio
                          {p.revenueByPlan.length === 1 ? '' : 's'}
                        </summary>
                        <ul className="mt-1 space-y-0.5">
                          {p.revenueByPlan.map((rp) => (
                            <li
                              key={rp.planId || 'particular'}
                              className="flex justify-between gap-3 font-mono text-[10px] font-normal text-slate-500"
                            >
                              <span className="truncate">{rp.planName}</span>
                              <span className="whitespace-nowrap tabular-nums">
                                {formatCurrency(rp.grossRevenueCents)} ·{' '}
                                {formatCurrency(rp.commissionCents)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-[11px] text-slate-600">
                    {formatCurrency(p.grossRevenueCents)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-[11px]">
                    {formatCurrency(p.commissionCents)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-[11px]">
                    {p.fixedPaymentCents !== 0 ? (
                      formatCurrency(p.fixedPaymentCents)
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-[11px]">
                    {p.liberalPaymentCents !== 0 ? (
                      formatCurrency(p.liberalPaymentCents)
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-[11px]">
                    {p.adjustmentsCents !== 0 ? (
                      <span
                        className={
                          p.adjustmentsCents < 0
                            ? 'text-destructive'
                            : 'text-success-text'
                        }
                      >
                        {p.adjustmentsCents > 0 ? '+' : ''}
                        {formatCurrency(p.adjustmentsCents)}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-xs font-bold">
                    {formatCurrency(p.totalDueCents)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={
                        p.status === 'pago'
                          ? 'h-5 bg-success-bg px-1.5 text-[10px] text-success-text'
                          : p.status === 'fechado'
                            ? 'h-5 bg-info-bg px-1.5 text-[10px] text-info-text'
                            : 'h-5 px-1.5 text-[10px]'
                      }
                    >
                      {p.status === 'aberto'
                        ? 'Aberto'
                        : p.status === 'fechado'
                          ? 'A pagar'
                          : 'Pago'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {snapshot.isClosed && p.status === 'fechado' && canMarkPaid ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => setMarkingPayout(p)}
                      >
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                        Marcar pago
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {!isOwnViewOnly && (canCloseMonth || canReopenMonth || canReopenReason) ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-4">
          {canCloseMonth ? (
            <Button onClick={() => void handleClose()} disabled={closing}>
              {closing ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Lock className="mr-1 h-4 w-4" />
              )}
              Fechar mês {month}
            </Button>
          ) : null}
          {canReopenMonth ? (
            <Button variant="outline" onClick={() => setShowReopenModal(true)}>
              <Unlock className="mr-1 h-4 w-4" /> Reabrir mês
            </Button>
          ) : null}
          {!canReopenMonth && canReopenReason && snapshot.isClosed ? (
            <span className="text-[11px] text-slate-500">
              Reabrir bloqueado: {canReopenReason}
            </span>
          ) : null}
          {error ? (
            <p className="text-[11px] font-semibold text-destructive">{error}</p>
          ) : null}
        </div>
      ) : null}

      {markingPayout ? (
        <MarkPaidModal
          month={month}
          payout={markingPayout}
          onClose={() => setMarkingPayout(null)}
          onSuccess={() => {
            setMarkingPayout(null)
            router.refresh()
          }}
        />
      ) : null}

      {showReopenModal ? (
        <ReopenModal
          month={month}
          onClose={() => setShowReopenModal(false)}
          onSuccess={() => {
            setShowReopenModal(false)
            router.refresh()
          }}
        />
      ) : null}
    </>
  )
}

function MarkPaidModal({
  month,
  payout,
  onClose,
  onSuccess,
}: {
  month: string
  payout: MonthlyPayoutLine
  onClose: () => void
  onSuccess: () => void
}) {
  const [amount, setAmount] = useState((payout.totalDueCents / 100).toFixed(2))
  const [method, setMethod] = useState('ted')
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 16))
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const cents = Math.round(Number(amount.replace(',', '.')) * 100)
    if (!cents || cents <= 0) { setError('Valor inválido'); return }
    setPending(true)
    try {
      const res = await fetch(
        `/api/financeiro/repasse-medico/${month}/payouts/${payout.id}/mark-paid`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            paid_at: new Date(paidAt).toISOString(),
            paid_amount_cents: cents,
            payment_method: method,
            payment_note: note.trim() || null,
          }),
        },
      )
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(body.error?.message ?? 'Falha.')
        return
      }
      onSuccess()
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Marcar repasse como pago</DialogTitle>
          <DialogDescription>
            {payout.doctorName} — total devido {formatCurrency(payout.totalDueCents)}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="amount">Valor pago (R$)</Label>
            <Input id="amount" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="method">Método</Label>
            <Input id="method" value={method} onChange={(e) => setMethod(e.target.value)} placeholder="ted, pix, ..." />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="paid_at">Data/hora</Label>
            <Input id="paid_at" type="datetime-local" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="note">Nota (opcional)</Label>
            <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} className="min-h-[60px]" placeholder="ex.: TED ref 123456" />
          </div>
          {error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">{error}</p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              <X className="mr-1 h-3 w-3" /> Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <CheckCircle2 className="mr-1 h-3 w-3" />}
              Confirmar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ReopenModal({
  month,
  onClose,
  onSuccess,
}: {
  month: string
  onClose: () => void
  onSuccess: () => void
}) {
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (reason.trim().length < 20) {
      setError('Motivo precisa ter pelo menos 20 caracteres')
      return
    }
    setPending(true)
    try {
      const res = await fetch(
        `/api/financeiro/repasse-medico/${month}/reopen`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason: reason.trim() }),
        },
      )
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(body.error?.message ?? 'Falha.')
        return
      }
      onSuccess()
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reabrir mês {month}</DialogTitle>
          <DialogDescription>
            Janela de 24h, nenhum repasse pode estar pago. Justificativa mínima 20 chars (forense).
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="reason">Motivo</Label>
            <Textarea
              id="reason"
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="min-h-[80px]"
              placeholder="ex.: Esqueci de incluir atendimento de 2026-04-28 que ficou em rascunho"
            />
            <p className="text-[10px] text-slate-400">{reason.trim().length} / 20 chars mínimo</p>
          </div>
          {error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">{error}</p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Unlock className="mr-1 h-3 w-3" />}
              Reabrir
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
