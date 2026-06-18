'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Banknote, Download, FileCheck2, Loader2, PackageCheck, RefreshCw, Scissors } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { formatCurrency, formatDateTime } from '@/lib/utils'

export interface GuiaRow {
  id: string
  number: string
  type: string
  status: string
  planId: string
  planName: string
  amountCents: number
  loteId: string | null
  pendingCount: number
  createdAt: string
}

export interface PlanGroup {
  planId: string
  planName: string
  guias: GuiaRow[]
}

export interface LoteRow {
  id: string
  number: string
  status: string
  planName: string
  hashMd5: string | null
  signedAt: string | null
  guiaCount: number
  createdAt: string
  billedCents: number
  receivedCents: number
}

const STATUS_LABEL: Record<string, string> = {
  rascunho: 'Rascunho',
  pronta: 'Pronta',
  exportada: 'Em lote',
  paga: 'Paga',
  glosada: 'Glosada',
  parcial: 'Parcial',
}

function statusBadge(status: string): JSX.Element {
  const label = STATUS_LABEL[status] ?? status
  if (status === 'pronta' || status === 'paga') {
    return <Badge variant="success">{label}</Badge>
  }
  if (status === 'rascunho' || status === 'parcial') {
    return <Badge variant="warning">{label}</Badge>
  }
  if (status === 'glosada') {
    return <Badge variant="destructive">{label}</Badge>
  }
  return <Badge variant="secondary">{label}</Badge>
}

export function TissPanel({
  prontaByPlan,
  guias,
  lotes,
}: {
  prontaByPlan: PlanGroup[]
  guias: GuiaRow[]
  lotes: LoteRow[]
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busyPlan, setBusyPlan] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [glosaTarget, setGlosaTarget] = useState<GuiaRow | null>(null)
  const [reapBusy, setReapBusy] = useState<string | null>(null)
  const [pagamentoTarget, setPagamentoTarget] = useState<LoteRow | null>(null)

  async function reapresentar(g: GuiaRow) {
    setError(null)
    setReapBusy(g.id)
    try {
      const res = await fetch('/api/tiss/glosas/reapresentar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ guiaId: g.id }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        throw new Error(body.error?.message ?? 'Falha ao reapresentar a guia.')
      }
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao reapresentar.')
    } finally {
      setReapBusy(null)
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function fecharLote(group: PlanGroup) {
    const guiaIds = group.guias.filter((g) => selected.has(g.id)).map((g) => g.id)
    if (guiaIds.length === 0) {
      setError('Selecione ao menos uma guia para fechar o lote.')
      return
    }
    setError(null)
    setBusyPlan(group.planId)
    try {
      const res = await fetch('/api/tiss/lotes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ healthPlanId: group.planId, guiaIds }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        loteId?: string
        error?: { message?: string }
      }
      if (!res.ok || !body.loteId) {
        throw new Error(body.error?.message ?? `Falha ao fechar o lote (${res.status}).`)
      }
      // Baixa o XML assinado imediatamente.
      triggerDownload(`/api/tiss/lotes/${body.loteId}/xml`)
      setSelected(new Set())
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao fechar o lote.')
    } finally {
      setBusyPlan(null)
    }
  }

  const selectedCountFor = (group: PlanGroup) =>
    group.guias.filter((g) => selected.has(g.id)).length

  return (
    <div className="space-y-6">
      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
          {error}
        </div>
      ) : null}

      {/* ---- Guias prontas para faturar ---- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <FileCheck2 className="h-4 w-4 text-primary" />
            Guias prontas para faturar
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {prontaByPlan.length === 0 ? (
            <p className="text-sm text-slate-500">
              Nenhuma guia pronta. Gere guias a partir dos atendimentos de convênio (botão
              &quot;Gerar guia TISS&quot; no atendimento).
            </p>
          ) : (
            prontaByPlan.map((group) => {
              const count = selectedCountFor(group)
              return (
                <div
                  key={group.planId}
                  className="rounded-lg border border-slate-200 bg-white"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
                    <span className="text-sm font-bold text-slate-900">
                      {group.planName}{' '}
                      <span className="text-xs font-medium text-slate-400">
                        ({group.guias.length} pronta{group.guias.length === 1 ? '' : 's'})
                      </span>
                    </span>
                    <Button
                      size="sm"
                      disabled={busyPlan !== null || count === 0}
                      onClick={() => void fecharLote(group)}
                      className="gap-1.5"
                    >
                      {busyPlan === group.planId ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <PackageCheck className="h-3.5 w-3.5" />
                      )}
                      Fechar lote{count > 0 ? ` (${count})` : ''}
                    </Button>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10" />
                        <TableHead>Guia</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.guias.map((g) => (
                        <TableRow key={g.id}>
                          <TableCell>
                            <input
                              type="checkbox"
                              checked={selected.has(g.id)}
                              onChange={() => toggle(g.id)}
                              className="h-4 w-4 rounded border-slate-300"
                            />
                          </TableCell>
                          <TableCell className="font-mono text-xs font-bold text-slate-900">
                            {g.number}
                          </TableCell>
                          <TableCell className="text-xs text-slate-600">
                            {g.type === 'sp_sadt' ? 'SP/SADT' : 'Consulta'}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs tabular-nums">
                            {formatCurrency(g.amountCents)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )
            })
          )}
        </CardContent>
      </Card>

      {/* ---- Lotes gerados ---- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <PackageCheck className="h-4 w-4 text-primary" />
            Lotes gerados
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {lotes.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-slate-500">Nenhum lote fechado ainda.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lote</TableHead>
                  <TableHead>Convênio</TableHead>
                  <TableHead className="text-center">Guias</TableHead>
                  <TableHead className="text-right">Faturado</TableHead>
                  <TableHead className="text-right">Recebido</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lotes.map((l) => {
                  const pending = Math.max(0, l.billedCents - l.receivedCents)
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="font-mono text-xs font-bold">{l.number}</TableCell>
                      <TableCell className="text-xs">{l.planName}</TableCell>
                      <TableCell className="text-center text-xs tabular-nums">
                        {l.guiaCount}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {formatCurrency(l.billedCents)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {formatCurrency(l.receivedCents)}
                        {pending > 0 && l.receivedCents > 0 ? (
                          <span className="ml-1 text-[10px] text-amber-600">
                            falta {formatCurrency(pending)}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>{statusBadge(l.status)}</TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex gap-1.5">
                          <a
                            href={`/api/tiss/lotes/${l.id}/xml`}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-700 hover:bg-slate-50"
                          >
                            <Download className="h-3 w-3" />
                            XML
                          </a>
                          {pending > 0 || l.receivedCents === 0 ? (
                            <button
                              type="button"
                              onClick={() => setPagamentoTarget(l)}
                              className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2 py-1 text-[10px] font-bold text-white hover:bg-slate-800"
                            >
                              <Banknote className="h-3 w-3" />
                              Receber
                            </button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ---- Todas as guias ---- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Todas as guias</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {guias.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-slate-500">Nenhuma guia gerada ainda.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Guia</TableHead>
                  <TableHead>Convênio</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Criada</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {guias.map((g) => {
                  const enviada = g.status === 'exportada' || g.status === 'paga'
                  const glosada = g.status === 'glosada' || g.status === 'parcial'
                  return (
                    <TableRow key={g.id}>
                      <TableCell className="font-mono text-xs font-bold">{g.number}</TableCell>
                      <TableCell className="text-xs">{g.planName}</TableCell>
                      <TableCell className="text-xs text-slate-600">
                        {g.type === 'sp_sadt' ? 'SP/SADT' : 'Consulta'}
                      </TableCell>
                      <TableCell>
                        {statusBadge(g.status)}
                        {g.status === 'rascunho' && g.pendingCount > 0 ? (
                          <span className="ml-1 text-[10px] text-amber-600">
                            {g.pendingCount} pendência{g.pendingCount === 1 ? '' : 's'}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {formatCurrency(g.amountCents)}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {formatDateTime(g.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        {enviada || glosada ? (
                          <div className="inline-flex gap-1.5">
                            {enviada || glosada ? (
                              <button
                                type="button"
                                onClick={() => setGlosaTarget(g)}
                                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-700 hover:bg-slate-50"
                              >
                                <Scissors className="h-3 w-3" /> Glosa
                              </button>
                            ) : null}
                            {glosada ? (
                              <button
                                type="button"
                                disabled={reapBusy === g.id}
                                onClick={() => void reapresentar(g)}
                                className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2 py-1 text-[10px] font-bold text-white hover:bg-slate-800 disabled:opacity-60"
                              >
                                {reapBusy === g.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <RefreshCw className="h-3 w-3" />
                                )}
                                Reapresentar
                              </button>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {glosaTarget ? (
        <GlosaModal
          guia={glosaTarget}
          onClose={() => setGlosaTarget(null)}
          onSuccess={() => {
            setGlosaTarget(null)
            router.refresh()
          }}
        />
      ) : null}

      {pagamentoTarget ? (
        <PagamentoModal
          lote={pagamentoTarget}
          onClose={() => setPagamentoTarget(null)}
          onSuccess={() => {
            setPagamentoTarget(null)
            router.refresh()
          }}
        />
      ) : null}
    </div>
  )
}

function PagamentoModal({
  lote,
  onClose,
  onSuccess,
}: {
  lote: LoteRow
  onClose: () => void
  onSuccess: () => void
}) {
  const pending = Math.max(0, lote.billedCents - lote.receivedCents)
  const [valor, setValor] = useState((pending / 100).toFixed(2))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const cents = Math.round(Number(valor.replace(',', '.')) * 100)
    if (!Number.isInteger(cents) || cents <= 0) {
      setError('Valor recebido inválido.')
      return
    }
    setBusy(true)
    try {
      const res = await fetch(`/api/tiss/lotes/${lote.id}/pagamentos`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amountCents: cents, note: note.trim() || null }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(body.error?.message ?? 'Falha ao registrar o recebimento.')
        return
      }
      onSuccess()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar recebimento</DialogTitle>
          <DialogDescription>
            Lote {lote.number} — {lote.planName}. Faturado {formatCurrency(lote.billedCents)},
            recebido {formatCurrency(lote.receivedCents)} (falta {formatCurrency(pending)}).
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pg-valor">Valor recebido (R$)</Label>
            <Input id="pg-valor" autoFocus value={valor} onChange={(e) => setValor(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pg-note">Observação (opcional)</Label>
            <Textarea
              id="pg-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="min-h-[50px]"
              placeholder="ex.: demonstrativo 0423, pagamento parcial por glosa"
            />
          </div>
          {error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Banknote className="mr-1 h-3 w-3" />}
              Registrar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function GlosaModal({
  guia,
  onClose,
  onSuccess,
}: {
  guia: GuiaRow
  onClose: () => void
  onSuccess: () => void
}) {
  const [motivoCode, setMotivoCode] = useState('')
  const [motivoText, setMotivoText] = useState('')
  const [valor, setValor] = useState((guia.amountCents / 100).toFixed(2))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const cents = Math.round(Number(valor.replace(',', '.')) * 100)
    if (!Number.isInteger(cents) || cents < 0) {
      setError('Valor glosado inválido.')
      return
    }
    setPending(true)
    try {
      const res = await fetch('/api/tiss/glosas', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          guiaId: guia.id,
          motivoCode: motivoCode.trim(),
          motivoText: motivoText.trim(),
          glosadoAmountCents: cents,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(body.error?.message ?? 'Falha ao registrar a glosa.')
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
          <DialogTitle>Registrar glosa</DialogTitle>
          <DialogDescription>
            Guia {guia.number} — {guia.planName}. Informe o motivo (Tabela 38) e o valor
            glosado.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="motivo-code">Motivo (código Tabela 38)</Label>
            <Input
              id="motivo-code"
              inputMode="numeric"
              maxLength={4}
              value={motivoCode}
              onChange={(e) => setMotivoCode(e.target.value)}
              placeholder="Ex.: 1707"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="motivo-text">Descrição do motivo</Label>
            <Textarea
              id="motivo-text"
              value={motivoText}
              onChange={(e) => setMotivoText(e.target.value)}
              className="min-h-[60px]"
              placeholder="Descrição da glosa informada pela operadora"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="glosa-valor">Valor glosado (R$)</Label>
            <Input
              id="glosa-valor"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
            />
          </div>
          {error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Scissors className="mr-1 h-3 w-3" />}
              Registrar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function triggerDownload(url: string) {
  const a = document.createElement('a')
  a.href = url
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}
