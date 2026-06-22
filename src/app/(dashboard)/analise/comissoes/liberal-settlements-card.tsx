'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'
import { HandCoins, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatCurrency } from '@/lib/utils'

interface DoctorTotal {
  doctorId: string
  doctorName: string
  totalCents: number
  paidCents: number
}

interface SettlementRow {
  id: string
  doctorId: string
  doctorName: string
  periodFrom: string
  periodTo: string
  amountCents: number
  note: string | null
  paidAt: string
}

function firstOfMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function today(): string {
  return new Date().toISOString().slice(0, 10)
}
function reaisToCents(v: string): number | null {
  const n = Number(v.replace(/\./g, '').replace(',', '.'))
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

/**
 * Card de honorários de profissionais liberais (participações) por período livre
 * (de/até — cobre semanal/quinzenal). Mostra o total por profissional e permite
 * marcar o período como pago.
 */
export function LiberalSettlementsCard() {
  const [from, setFrom] = useState(firstOfMonth)
  const [to, setTo] = useState(today)
  const [rows, setRows] = useState<DoctorTotal[]>([])
  const [settlements, setSettlements] = useState<SettlementRow[]>([])
  const [loading, setLoading] = useState(false)
  const [payingId, setPayingId] = useState<string | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [payNote, setPayNote] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/financeiro/liberais?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { cache: 'no-store' },
      )
      if (res.ok) {
        const b = (await res.json()) as { rows: DoctorTotal[]; settlements: SettlementRow[] }
        setRows(b.rows)
        setSettlements(b.settlements)
      } else {
        setError('Falha ao carregar.')
      }
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function startPay(d: DoctorTotal) {
    setPayingId(d.doctorId)
    setPayAmount(((d.totalCents - d.paidCents) / 100).toFixed(2).replace('.', ','))
    setPayNote('')
    setError(null)
  }

  async function confirmPay(d: DoctorTotal) {
    const cents = reaisToCents(payAmount)
    if (cents === null) {
      setError('Valor inválido.')
      return
    }
    setPending(true)
    try {
      const res = await fetch('/api/financeiro/liberais', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          doctor_id: d.doctorId,
          from,
          to,
          amount_cents: cents,
          note: payNote.trim() || null,
        }),
      })
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(b.error?.message ?? 'Falha ao registrar pagamento.')
        return
      }
      setPayingId(null)
      await load()
    } finally {
      setPending(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <HandCoins className="h-4 w-4 text-primary" />
          Profissionais liberais — pagamento por período
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-slate-500">
          Honorários de participação no período (de/até). Some por profissional e marque o período
          como pago — ideal para acertos semanais/quinzenais.
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-[11px] font-bold uppercase text-slate-500">De</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          </div>
          <div>
            <Label className="text-[11px] font-bold uppercase text-slate-500">Até</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </div>
          <Button type="button" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            Buscar
          </Button>
        </div>

        {error ? <p className="text-xs font-semibold text-destructive">{error}</p> : null}

        {rows.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-500">
            Nenhum honorário de participação no período.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-[10px] uppercase tracking-widest text-slate-500">
                  <th className="px-3 py-2 font-bold">Profissional</th>
                  <th className="px-3 py-2 text-right font-bold">Honorários</th>
                  <th className="px-3 py-2 text-right font-bold">Já pago</th>
                  <th className="px-3 py-2 text-right font-bold">Ação</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const remaining = d.totalCents - d.paidCents
                  return (
                    <Fragment key={d.doctorId}>
                      <tr className="border-b border-slate-100">
                        <td className="px-3 py-2 font-medium text-slate-900">{d.doctorName}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {formatCurrency(d.totalCents)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-500">
                          {d.paidCents > 0 ? formatCurrency(d.paidCents) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {remaining > 0 ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => startPay(d)}
                            >
                              Marcar pago
                            </Button>
                          ) : (
                            <span className="text-[11px] font-semibold text-success-text">quitado</span>
                          )}
                        </td>
                      </tr>
                      {payingId === d.doctorId ? (
                        <tr className="border-b border-slate-100 bg-slate-50/60">
                          <td colSpan={4} className="px-3 py-3">
                            <div className="flex flex-wrap items-end gap-3">
                              <div>
                                <Label className="text-[11px] font-bold uppercase text-slate-500">
                                  Valor pago (R$)
                                </Label>
                                <Input
                                  value={payAmount}
                                  onChange={(e) => setPayAmount(e.target.value)}
                                  className="w-32"
                                />
                              </div>
                              <div className="flex-1 min-w-[160px]">
                                <Label className="text-[11px] font-bold uppercase text-slate-500">
                                  Observação
                                </Label>
                                <Input
                                  value={payNote}
                                  onChange={(e) => setPayNote(e.target.value)}
                                  maxLength={500}
                                  placeholder="Ex.: PIX, semana 01–07"
                                />
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => void confirmPay(d)}
                                disabled={pending}
                                className="gap-2"
                              >
                                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                Confirmar
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => setPayingId(null)}
                                disabled={pending}
                              >
                                Cancelar
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {settlements.length > 0 ? (
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-400">
              Pagamentos registrados
            </p>
            <ul className="space-y-1">
              {settlements.slice(0, 12).map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                >
                  <span className="font-semibold text-slate-800">{s.doctorName}</span>
                  <span className="text-slate-400">
                    {fmtBr(s.periodFrom)} – {fmtBr(s.periodTo)}
                  </span>
                  <span className="ml-auto font-mono font-semibold tabular-nums">
                    {formatCurrency(s.amountCents)}
                  </span>
                  {s.note ? <span className="w-full text-slate-400">{s.note}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function fmtBr(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ymd
}
