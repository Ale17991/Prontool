'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Clock,
  CreditCard,
  Loader2,
  TrendingUp,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
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
import { cn, formatCurrency, formatDate, formatDateTime } from '@/lib/utils'
import type {
  PatientFinancialSummary,
  PaymentInstallmentDTO,
  PaymentRecordDTO,
} from '@/lib/core/payments/list'

type PaymentMethod =
  | 'dinheiro'
  | 'pix'
  | 'cartao_credito'
  | 'cartao_debito'
  | 'boleto'
  | 'convenio'
  | 'outro'

const METHOD_LABEL: Record<PaymentMethod, string> = {
  dinheiro: 'Dinheiro',
  pix: 'PIX',
  cartao_credito: 'Cartão de crédito',
  cartao_debito: 'Cartão de débito',
  boleto: 'Boleto',
  convenio: 'Convênio',
  outro: 'Outro',
}

interface Props {
  patientId: string
  initialRecords: PaymentRecordDTO[]
  initialSummary: PatientFinancialSummary
  canRecordPayment: boolean
}

export function FinanceiroSection({
  patientId,
  initialRecords,
  initialSummary,
  canRecordPayment,
}: Props) {
  const router = useRouter()
  const [records, setRecords] = useState(initialRecords)
  const [summary, setSummary] = useState(initialSummary)
  const [, startTransition] = useTransition()

  async function refresh() {
    const res = await fetch(`/api/pacientes/${patientId}/pagamentos`)
    if (res.ok) {
      const body = (await res.json()) as {
        records: PaymentRecordDTO[]
        summary: PatientFinancialSummary
      }
      setRecords(body.records)
      setSummary(body.summary)
    }
    startTransition(() => router.refresh())
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <CircleDollarSign className="h-4 w-4 text-primary" />
          Financeiro
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat
            icon={TrendingUp}
            label="Total faturado"
            value={formatCurrency(summary.totalAmountCents)}
          />
          <Stat
            icon={CheckCircle2}
            label="Total pago"
            value={formatCurrency(summary.paidAmountCents)}
            tone="emerald"
          />
          <Stat
            icon={Clock}
            label="Pendente"
            value={formatCurrency(summary.pendingAmountCents)}
            tone="amber"
          />
          <Stat
            icon={CreditCard}
            label="Atrasado"
            value={formatCurrency(summary.overdueAmountCents)}
            tone={summary.overdueAmountCents > 0 ? 'rose' : 'slate'}
          />
        </div>

        {records.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">
            Nenhum pagamento registrado para este paciente.
          </p>
        ) : (
          <div className="space-y-2">
            {records.map((r) => (
              <PaymentRow
                key={r.id}
                record={r}
                canRecordPayment={canRecordPayment}
                onChange={refresh}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Stat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof TrendingUp
  label: string
  value: string
  tone?: 'emerald' | 'amber' | 'rose' | 'slate'
}) {
  const toneCls =
    tone === 'emerald'
      ? 'text-emerald-700'
      : tone === 'amber'
        ? 'text-amber-700'
        : tone === 'rose'
          ? 'text-rose-700'
          : 'text-slate-900'
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-slate-400" />
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
          {label}
        </p>
      </div>
      <p className={cn('mt-1 text-lg font-black tabular-nums', toneCls)}>{value}</p>
    </div>
  )
}

function PaymentRow({
  record,
  canRecordPayment,
  onChange,
}: {
  record: PaymentRecordDTO
  canRecordPayment: boolean
  onChange: () => void | Promise<void>
}) {
  const [expanded, setExpanded] = useState(false)
  const overdueCount = record.installments.filter((i) => i.isOverdue).length

  return (
    <div className="rounded-md border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start justify-between gap-4 px-4 py-3 text-left hover:bg-slate-50"
      >
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 text-slate-400">
            {expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-xs text-slate-500">
              {formatDateTime(record.createdAt)}
            </p>
            <p className="text-sm font-bold text-slate-900">
              {record.procedureLabel ?? 'Pagamento avulso'}
            </p>
            <p className="text-[11px] text-slate-500">
              {METHOD_LABEL[record.paymentMethod as PaymentMethod] ?? record.paymentMethod}
              {record.installmentsCount > 1
                ? ` · ${record.installmentsCount} parcelas`
                : ''}
              {overdueCount > 0 ? ` · ${overdueCount} atrasada(s)` : ''}
            </p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-bold text-slate-900 tabular-nums">
            {formatCurrency(record.totalAmountCents)}
          </p>
          <RecordStatusBadge status={record.paymentStatus} />
        </div>
      </button>

      {expanded ? (
        <div className="border-t border-slate-100 px-4 py-3">
          <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600 md:grid-cols-4">
            <span>Pago: <strong className="text-slate-900">{formatCurrency(record.paidAmountCents)}</strong></span>
            <span>Pendente: <strong className="text-slate-900">{formatCurrency(record.pendingAmountCents)}</strong></span>
            <span>Atrasado: <strong className={record.overdueAmountCents > 0 ? 'text-rose-700' : 'text-slate-900'}>{formatCurrency(record.overdueAmountCents)}</strong></span>
            <span>Status: <RecordStatusBadge status={record.paymentStatus} /></span>
          </div>
          <ul className="mt-3 divide-y divide-slate-100">
            {record.installments.map((inst) => (
              <InstallmentRow
                key={inst.id}
                paymentRecordId={record.id}
                installment={inst}
                canRecordPayment={canRecordPayment}
                onChange={onChange}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function RecordStatusBadge({ status }: { status: string }) {
  if (status === 'pago') return <Badge variant="success">Pago</Badge>
  if (status === 'parcial') return <Badge variant="warning">Parcial</Badge>
  if (status === 'cancelado') return <Badge variant="secondary">Cancelado</Badge>
  return <Badge variant="outline">Pendente</Badge>
}

function InstallmentBadge({ inst }: { inst: PaymentInstallmentDTO }) {
  if (inst.status === 'pago') return <Badge variant="success">Pago</Badge>
  if (inst.status === 'cancelado') return <Badge variant="secondary">Cancelado</Badge>
  if (inst.isOverdue) return <Badge variant="destructive">Atrasado</Badge>
  return <Badge variant="outline">Pendente</Badge>
}

function InstallmentRow({
  paymentRecordId,
  installment,
  canRecordPayment,
  onChange,
}: {
  paymentRecordId: string
  installment: PaymentInstallmentDTO
  canRecordPayment: boolean
  onChange: () => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  return (
    <li className="flex flex-wrap items-center gap-3 py-2 text-xs">
      <span className="w-6 text-center font-mono font-bold text-slate-500">
        #{installment.installmentNumber}
      </span>
      <span className="font-bold text-slate-900 tabular-nums">
        {formatCurrency(installment.amountCents)}
      </span>
      <span className="text-slate-500">venc. {formatDate(installment.dueDate)}</span>
      <InstallmentBadge inst={installment} />
      {installment.paidAt ? (
        <span className="text-[10px] text-slate-500">
          pago em {formatDate(installment.paidAt)}
          {installment.paymentMethod
            ? ` · ${METHOD_LABEL[installment.paymentMethod as PaymentMethod] ?? installment.paymentMethod}`
            : ''}
        </span>
      ) : null}
      {canRecordPayment && installment.status === 'pendente' ? (
        <div className="ml-auto">
          <RecordPaymentDialog
            paymentRecordId={paymentRecordId}
            installment={installment}
            open={open}
            onOpenChange={setOpen}
            onPaid={onChange}
          />
        </div>
      ) : null}
    </li>
  )
}

function RecordPaymentDialog({
  paymentRecordId,
  installment,
  open,
  onOpenChange,
  onPaid,
}: {
  paymentRecordId: string
  installment: PaymentInstallmentDTO
  open: boolean
  onOpenChange: (next: boolean) => void
  onPaid: () => void | Promise<void>
}) {
  const [amountReais, setAmountReais] = useState(
    (installment.amountCents / 100).toFixed(2),
  )
  const [method, setMethod] = useState<PaymentMethod>('pix')
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10))
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const cents = Math.round(Number(amountReais.replace(',', '.')) * 100)
    if (!Number.isFinite(cents) || cents < 0) {
      setError('Valor pago inválido.')
      return
    }
    setPending(true)
    try {
      const res = await fetch(
        `/api/pagamentos/${paymentRecordId}/parcelas/${installment.id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            paid_amount_cents: cents,
            payment_method: method,
            paid_at: new Date(paidAt).toISOString(),
          }),
        },
      )
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        setError(body.error?.message ?? 'Falha ao registrar pagamento.')
        return
      }
      onOpenChange(false)
      await onPaid()
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Button
        size="sm"
        variant="outline"
        onClick={() => onOpenChange(true)}
        className="h-7 gap-1 px-2 text-[11px]"
      >
        <CheckCircle2 className="h-3 w-3" />
        Registrar pagamento
      </Button>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar pagamento — Parcela {installment.installmentNumber}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="paid_amount">Valor pago (R$)</Label>
            <Input
              id="paid_amount"
              inputMode="decimal"
              value={amountReais}
              onChange={(e) => setAmountReais(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Método</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => (
                  <SelectItem key={m} value={m}>
                    {METHOD_LABEL[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="paid_at">Data do pagamento</Label>
            <Input
              id="paid_at"
              type="date"
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
            />
          </div>
          {error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={pending} className="gap-2">
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Confirmar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
