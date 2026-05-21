'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, History, Loader2, RefreshCw, X } from 'lucide-react'
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
import type { PayableRow, PayableStatus } from '@/lib/core/accounts-payable'

const STATUS_LABEL: Record<PayableStatus, string> = {
  a_vencer: 'A vencer',
  vencida: 'Vencida',
  paga: 'Paga',
}

const STATUS_CLASS: Record<PayableStatus, string> = {
  a_vencer: 'bg-info-bg text-info-text',
  vencida: 'bg-[hsl(var(--alert)/0.15)] text-[hsl(var(--alert))]',
  paga: 'bg-success-bg text-success-text',
}

const CATEGORY_LABEL: Record<string, string> = {
  aluguel: 'Aluguel',
  equipamentos: 'Equipamentos',
  materiais: 'Materiais',
  pessoal: 'Pessoal',
  servicos: 'Serviços',
  impostos: 'Impostos',
  manutencao: 'Manutenção',
  outros: 'Outros',
}

interface Props {
  rows: PayableRow[]
}

export function PayablesTable({ rows }: Props) {
  const router = useRouter()
  const [payingId, setPayingId] = useState<string | null>(null)
  const [versioningId, setVersioningId] = useState<string | null>(null)

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 py-10 text-center">
        <p className="text-sm text-slate-500">Sem despesas no período.</p>
      </div>
    )
  }

  return (
    <>
      <div className="overflow-x-auto rounded-md border border-slate-200">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-[10px] uppercase tracking-widest">Vencimento</TableHead>
              <TableHead className="text-[10px] uppercase tracking-widest">Descrição</TableHead>
              <TableHead className="text-[10px] uppercase tracking-widest">Fornecedor</TableHead>
              <TableHead className="text-[10px] uppercase tracking-widest">Categoria</TableHead>
              <TableHead className="text-[10px] uppercase tracking-widest">Valor</TableHead>
              <TableHead className="text-[10px] uppercase tracking-widest">Status</TableHead>
              <TableHead className="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} className={r.isProjection ? 'opacity-70' : ''}>
                <TableCell className="whitespace-nowrap font-mono text-[11px]">
                  {formatDate(r.competenceDate)}
                </TableCell>
                <TableCell className="text-xs">
                  {r.description}
                  {r.isProjection ? (
                    <Badge variant="secondary" className="ml-2 h-4 px-1 text-[9px]">
                      Projeção
                    </Badge>
                  ) : r.recurring ? (
                    <Badge variant="secondary" className="ml-2 h-4 px-1 text-[9px]">
                      Recorrente
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell className="text-xs">{r.supplier ?? '—'}</TableCell>
                <TableCell className="text-xs">
                  {CATEGORY_LABEL[r.category] ?? r.category}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs font-bold">
                  {formatCurrency(r.amountCents)}
                </TableCell>
                <TableCell>
                  <Badge
                    variant="secondary"
                    className={cn('h-5 px-1.5 text-[10px]', STATUS_CLASS[r.status])}
                  >
                    {STATUS_LABEL[r.status]}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    {!r.isProjection && r.status !== 'paga' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => setPayingId(r.id)}
                      >
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                        Pagar
                      </Button>
                    ) : null}
                    {!r.isProjection && r.recurring && !r.supersededBy ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => setVersioningId(r.id)}
                        title="Reajustar valor com versionamento"
                      >
                        <RefreshCw className="h-3 w-3" />
                      </Button>
                    ) : null}
                    {r.supersededBy ? (
                      <span title="Substituída por nova versão">
                        <History className="h-3 w-3 text-slate-400" />
                      </span>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {payingId ? (
        <PayExpenseModal
          row={rows.find((r) => r.id === payingId)!}
          onClose={() => setPayingId(null)}
          onSuccess={() => {
            setPayingId(null)
            router.refresh()
          }}
        />
      ) : null}

      {versioningId ? (
        <VersionExpenseModal
          row={rows.find((r) => r.id === versioningId)!}
          onClose={() => setVersioningId(null)}
          onSuccess={() => {
            setVersioningId(null)
            router.refresh()
          }}
        />
      ) : null}
    </>
  )
}

function PayExpenseModal({
  row,
  onClose,
  onSuccess,
}: {
  row: PayableRow
  onClose: () => void
  onSuccess: () => void
}) {
  const [amount, setAmount] = useState((row.amountCents / 100).toFixed(2))
  const [method, setMethod] = useState('boleto')
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 16))
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
    setPending(true)
    try {
      const res = await fetch(`/api/financeiro/contas-a-pagar/${row.id}/pay`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          paid_at: new Date(paidAt).toISOString(),
          paid_amount_cents: cents,
          payment_method: method,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        setError(body.error?.message ?? 'Falha ao marcar pagamento.')
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
          <DialogTitle>Marcar como paga</DialogTitle>
          <DialogDescription>
            {row.description} — vence em {formatDate(row.competenceDate)}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="amount">Valor pago (R$)</Label>
            <Input id="amount" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="method">Método</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger id="method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="boleto">Boleto</SelectItem>
                <SelectItem value="pix">PIX</SelectItem>
                <SelectItem value="transferencia">Transferência</SelectItem>
                <SelectItem value="cartao_credito">Cartão de crédito</SelectItem>
                <SelectItem value="cartao_debito">Cartão de débito</SelectItem>
                <SelectItem value="dinheiro">Dinheiro</SelectItem>
                <SelectItem value="outro">Outro</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="paid_at">Data/hora</Label>
            <Input id="paid_at" type="datetime-local" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
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
              {pending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <CheckCircle2 className="mr-1 h-3 w-3" />}
              Confirmar pagamento
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function VersionExpenseModal({
  row,
  onClose,
  onSuccess,
}: {
  row: PayableRow
  onClose: () => void
  onSuccess: () => void
}) {
  const [effectiveFrom, setEffectiveFrom] = useState(
    new Date(Date.now() + 86400000).toISOString().slice(0, 10),
  )
  const [newAmount, setNewAmount] = useState((row.amountCents / 100).toFixed(2))
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const cents = Math.round(Number(newAmount.replace(',', '.')) * 100)
    if (!cents || cents <= 0) { setError('Novo valor inválido'); return }
    if (reason.trim().length < 3) { setError('Motivo é obrigatório'); return }
    setPending(true)
    try {
      const res = await fetch(`/api/financeiro/contas-a-pagar/${row.id}/version`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          effective_from: effectiveFrom,
          new_amount_cents: cents,
          reason: reason.trim(),
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(body.error?.message ?? 'Falha ao versionar.')
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
          <DialogTitle>Reajustar valor (versionar)</DialogTitle>
          <DialogDescription>
            Despesa atual será encerrada na véspera de &quot;Vigente a partir de&quot; e nova versão criada. Histórico preservado (Princípio I).
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ef">Vigente a partir de</Label>
            <Input id="ef" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="na">Novo valor (R$)</Label>
            <Input id="na" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} placeholder={(row.amountCents / 100).toFixed(2)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reason">Motivo</Label>
            <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: reajuste contratual anual" className="min-h-[60px]" />
          </div>
          {error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">{error}</p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              <X className="mr-1 h-3 w-3" /> Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
              Versionar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
