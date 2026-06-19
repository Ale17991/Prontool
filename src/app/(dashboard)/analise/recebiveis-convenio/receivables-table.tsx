'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatCurrency } from '@/lib/utils'

type ReceiptStatus = 'pendente' | 'recebido' | 'glosado' | 'nao_recebido'

export interface ReceivableRow {
  procedureLineId: string
  appointmentId: string
  appointmentAt: string
  planName: string
  procedureLabel: string
  doctorName: string
  patientName: string
  amountCents: number
  status: ReceiptStatus
  receivedAt: string | null
}

const STATUS_META: Record<ReceiptStatus, { label: string; cls: string }> = {
  pendente: { label: 'Pendente', cls: 'bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning-foreground))]' },
  recebido: { label: 'Recebido', cls: 'bg-success-bg text-success-text' },
  glosado: { label: 'Glosado', cls: 'bg-destructive/10 text-destructive' },
  nao_recebido: { label: 'Não recebido', cls: 'bg-slate-100 text-slate-600' },
}

const ACTIONS: ReceiptStatus[] = ['recebido', 'pendente', 'glosado', 'nao_recebido']

export function ReceivablesTable({
  rows,
  canManage,
}: {
  rows: ReceivableRow[]
  canManage: boolean
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pending, setPending] = useState<ReceiptStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  const allSelected = rows.length > 0 && selected.size === rows.length

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.procedureLineId)))
  }

  async function mark(status: ReceiptStatus) {
    if (selected.size === 0) return
    setError(null)
    setPending(status)
    try {
      const res = await fetch('/api/financeiro/recebiveis-convenio', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ procedure_line_ids: Array.from(selected), status }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(body.error?.message ?? 'Falha ao marcar.')
        return
      }
      setSelected(new Set())
      router.refresh()
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="space-y-3">
      {canManage ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2">
          <span className="text-xs font-semibold text-slate-600">
            {selected.size} selecionado{selected.size === 1 ? '' : 's'}
          </span>
          <span className="text-xs text-slate-400">Marcar como:</span>
          {ACTIONS.map((s) => (
            <Button
              key={s}
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={selected.size === 0 || pending !== null}
              onClick={() => mark(s)}
            >
              {pending === s ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
              {STATUS_META[s].label}
            </Button>
          ))}
          {error ? <span className="text-xs font-semibold text-destructive">{error}</span> : null}
        </div>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            {canManage ? (
              <TableHead className="w-8">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Selecionar tudo" />
              </TableHead>
            ) : null}
            <TableHead>Data</TableHead>
            <TableHead>Paciente</TableHead>
            <TableHead>Convênio</TableHead>
            <TableHead>Procedimento</TableHead>
            <TableHead>Profissional</TableHead>
            <TableHead className="text-right">Valor</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.procedureLineId} data-state={selected.has(r.procedureLineId) ? 'selected' : undefined}>
              {canManage ? (
                <TableCell>
                  <input
                    type="checkbox"
                    checked={selected.has(r.procedureLineId)}
                    onChange={() => toggle(r.procedureLineId)}
                    aria-label="Selecionar"
                  />
                </TableCell>
              ) : null}
              <TableCell className="whitespace-nowrap text-xs text-slate-600">
                {formatDateBr(r.appointmentAt)}
              </TableCell>
              <TableCell className="font-medium text-slate-900">{r.patientName}</TableCell>
              <TableCell className="text-slate-700">{r.planName}</TableCell>
              <TableCell className="text-slate-700">{r.procedureLabel}</TableCell>
              <TableCell className="text-slate-700">{r.doctorName}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums text-slate-900">
                {formatCurrency(r.amountCents)}
              </TableCell>
              <TableCell>
                <span
                  className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-bold ${STATUS_META[r.status].cls}`}
                >
                  {STATUS_META[r.status].label}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function formatDateBr(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}
