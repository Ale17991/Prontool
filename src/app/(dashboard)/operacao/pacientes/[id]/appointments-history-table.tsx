'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardPlus, Loader2 } from 'lucide-react'
import {
  AppointmentStatusBadge,
  effectiveStatusToVariant,
} from '@/components/ui/appointment-status-badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatCurrency, formatDateTime } from '@/lib/utils'

export interface AppointmentHistoryRow {
  id: string
  appointmentAt: string | null
  frozenAmountCents: number | null
  netAmountCents: number | null
  effectiveStatus: string | null
  /** Null = orfao (sem step vinculada). Botao "Adicionar ao plano" aparece. */
  stepId: string | null
}

export function AppointmentsHistoryTable({
  patientId,
  rows,
  canImportToPlan,
}: {
  patientId: string
  rows: AppointmentHistoryRow[]
  canImportToPlan: boolean
}) {
  if (rows.length === 0) {
    return (
      <p className="px-6 pb-6 text-sm text-slate-500">
        Nenhum atendimento registrado para este paciente.
      </p>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Data</TableHead>
          <TableHead>Valor bruto</TableHead>
          <TableHead>Valor líquido</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <AppointmentRowView
            key={row.id}
            patientId={patientId}
            row={row}
            canImportToPlan={canImportToPlan}
          />
        ))}
      </TableBody>
    </Table>
  )
}

function AppointmentRowView({
  patientId,
  row,
  canImportToPlan,
}: {
  patientId: string
  row: AppointmentHistoryRow
  canImportToPlan: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const isReversed = row.effectiveStatus === 'estornado'
  const isOrphan = row.stepId === null
  const showImportButton =
    canImportToPlan && isOrphan && !isReversed

  async function handleImport() {
    setError(null)
    try {
      const res = await fetch(
        `/api/pacientes/${patientId}/atendimentos/${row.id}/importar-para-plano`,
        { method: 'POST', headers: { 'content-type': 'application/json' } },
      )
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
        setError(data?.error?.message ?? 'Falha ao adicionar ao plano')
        return
      }
      startTransition(() => router.refresh())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado')
    }
  }

  return (
    <TableRow className="group">
      <TableCell className="text-slate-700">{formatDateTime(row.appointmentAt)}</TableCell>
      <TableCell className="font-semibold text-slate-900">
        {formatCurrency(row.frozenAmountCents)}
      </TableCell>
      <TableCell className="font-bold text-slate-900">
        {formatCurrency(row.netAmountCents)}
      </TableCell>
      <TableCell>
        <AppointmentStatusBadge variant={effectiveStatusToVariant(row.effectiveStatus)} />
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-2">
          {showImportButton ? (
            <button
              type="button"
              onClick={handleImport}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
              title="Cria uma etapa no plano de tratamento vinculada a este atendimento"
            >
              {isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ClipboardPlus className="h-3 w-3" />
              )}
              Adicionar ao plano
            </button>
          ) : null}
          <Link
            href={`/operacao/atendimentos/${row.id}`}
            className="text-xs font-bold text-primary opacity-0 transition-opacity group-hover:opacity-100"
          >
            Abrir
          </Link>
        </div>
        {error ? (
          <p className="mt-1 text-right text-[11px] text-rose-600">{error}</p>
        ) : null}
      </TableCell>
    </TableRow>
  )
}
