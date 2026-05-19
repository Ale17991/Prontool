'use client'

import { useState, useTransition } from 'react'
import { RefreshCw } from 'lucide-react'
import type { HistoryRow } from '@/lib/core/reminders/history'

interface HistoryTableProps {
  rows: HistoryRow[]
}

function formatBrasilia(iso: string): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso))
}

function statusBadge(status: string): { label: string; cls: string } {
  switch (status) {
    case 'sent':
      return { label: 'Enviado', cls: 'bg-success-bg text-success-strong' }
    case 'failed':
      return { label: 'Falhou', cls: 'bg-destructive/10 text-destructive' }
    case 'queued':
      return { label: 'Na fila', cls: 'bg-info-bg text-info-text' }
    case 'skipped_opt_out':
      return { label: 'Opt-out', cls: 'bg-muted text-slate-600' }
    case 'skipped_reversed':
      return { label: 'Estornado', cls: 'bg-muted text-slate-600' }
    case 'skipped_no_email':
      return { label: 'Sem email', cls: 'bg-muted text-slate-600' }
    case 'skipped_doctor_inactive':
      return { label: 'Médico inativo', cls: 'bg-muted text-slate-600' }
    default:
      return { label: status, cls: 'bg-muted text-slate-600' }
  }
}

export function HistoryTable({ rows }: HistoryTableProps) {
  const [pending, startTransition] = useTransition()
  const [resending, setResending] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  function reenviar(appointmentId: string) {
    if (pending) return
    setResending(appointmentId)
    setFeedback(null)
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/lembretes/${encodeURIComponent(appointmentId)}/reenviar`,
          { method: 'POST' },
        )
        const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
        if (!res.ok) {
          const code = (json.error as string) ?? 'UNKNOWN'
          setFeedback({ type: 'error', msg: `Erro ao reenviar (${code})` })
          return
        }
        const status = (json.status as string) ?? '—'
        setFeedback({
          type: status === 'sent' ? 'success' : 'error',
          msg: status === 'sent' ? 'Reenviado com sucesso.' : `Falhou (${status}).`,
        })
        // Atualiza a página para refletir o novo registro
        if (typeof window !== 'undefined') {
          window.location.reload()
        }
      } catch (err) {
        setFeedback({
          type: 'error',
          msg: err instanceof Error ? err.message : 'Erro de rede',
        })
      } finally {
        setResending(null)
      }
    })
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-slate-500">
        Nenhum lembrete enviado ainda. Quando o motor processar a primeira consulta
        elegível, ela aparecerá aqui.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {feedback && (
        <div
          role="alert"
          className={
            feedback.type === 'success'
              ? 'rounded-md border border-success/30 bg-success-bg p-3 text-sm text-success-strong'
              : 'rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive'
          }
        >
          {feedback.msg}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Consulta</th>
              <th className="px-3 py-2">Profissional</th>
              <th className="px-3 py-2">Procedimento</th>
              <th className="px-3 py-2">Antecedência</th>
              <th className="px-3 py-2">Enviado em</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const badge = statusBadge(r.status)
              return (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 text-slate-900">
                    {formatBrasilia(r.appointmentAt)}
                  </td>
                  <td className="px-3 py-2 text-slate-700">{r.doctorFullName}</td>
                  <td className="px-3 py-2 text-slate-700">{r.procedureName}</td>
                  <td className="px-3 py-2 text-slate-700">
                    {r.scheduledOffsetHours === -1 ? 'manual' : `${r.scheduledOffsetHours}h`}
                  </td>
                  <td className="px-3 py-2 text-slate-700">
                    {r.sentAt ? formatBrasilia(r.sentAt) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls}`}
                    >
                      {badge.label}
                    </span>
                    {r.isManual && (
                      <span className="ml-1 text-[10px] text-slate-400">(manual)</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => reenviar(r.appointmentId)}
                      disabled={pending}
                      title="Reenviar lembrete"
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <RefreshCw
                        className={`h-3 w-3 ${resending === r.appointmentId ? 'animate-spin' : ''}`}
                      />
                      Reenviar
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
