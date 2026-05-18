'use client'

import Link from 'next/link'
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from 'react'
import { useRouter } from 'next/navigation'
import {
  Check,
  DollarSign,
  History,
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
  /** Codigo a exibir: TUSS para listados, codigo personalizado para
   * procedimentos com custom_code_id, ou "Não listado" como fallback. */
  tussCode: string
  displayName: string | null
  /** Descricao do catalogo (TUSS ou codigo personalizado). Usada como
   * fallback na busca por nome quando o usuario nao definiu display_name
   * customizado — sem isso, "Facectomia" nao casa um TUSS 30306027 com
   * display_name=NULL e o procedimento parece sumir da lista. */
  catalogDescription?: string | null
  /** true quando procedure.is_unlisted=true (com ou sem codigo personalizado). */
  isUnlisted?: boolean
  /** true quando o procedimento tem codigo personalizado (badge violeta). */
  isCustomCoded?: boolean
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
  const addableCount = procedures.filter((p) => !pricedProcedureIds.has(p.id)).length

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
          procedures.length === 0 ? (
            <div className="rounded-md border border-warning/30 bg-[hsl(var(--warning)/0.1)] px-3 py-2 text-xs font-semibold text-[hsl(var(--warning-foreground))]">
              Nenhum procedimento com cobertura por plano cadastrado nesta clínica.{' '}
              <Link href="/configuracoes/procedimentos" className="underline">
                Cadastrar procedimento
              </Link>{' '}
              (marque &quot;Coberto pelo plano de saúde&quot;).
            </div>
          ) : addableCount === 0 ? (
            <div className="rounded-md border border-warning/30 bg-[hsl(var(--warning)/0.1)] px-3 py-2 text-xs font-semibold text-[hsl(var(--warning-foreground))]">
              Todos os {procedures.length} procedimento{procedures.length === 1 ? '' : 's'}{' '}
              cobertos já têm preço cadastrado neste convênio.{' '}
              <Link href="/configuracoes/procedimentos" className="underline">
                Cadastrar novo procedimento
              </Link>
            </div>
          ) : (
            <AddProcedureForm
              planId={planId}
              procedures={procedures}
              pricedProcedureIds={pricedProcedureIds}
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
                <TableHead className="text-right">Ações</TableHead>
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
            <Badge variant="warning">
              Agora particular
            </Badge>
          ) : (
            <Badge variant="success">Vigente</Badge>
          )}
        </TableCell>
        <TableCell className="text-right">
          <div className="inline-flex items-center justify-end gap-3">
            <Link
              href={`/configuracoes/precos/${head.priceVersionId}`}
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-primary hover:underline"
              title="Ver histórico de versões deste preço (todas as alterações)"
            >
              <History className="h-3 w-3" /> Ver histórico
            </Link>
            {canWrite && !editing ? (
              <button
                type="button"
                onClick={onEditStart}
                className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"
              >
                <Pencil className="h-3 w-3" /> Alterar valor
              </button>
            ) : null}
          </div>
        </TableCell>
      </TableRow>
      {editing ? (
        <TableRow className="bg-slate-50/50">
          <TableCell colSpan={6}>
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
  pricedProcedureIds,
  onAdded,
}: {
  planId: string
  procedures: ProcedureOption[]
  pricedProcedureIds: Set<string>
  onAdded: (next: PriceHeadWithProcedure) => void
}) {
  const [search, setSearch] = useState('')
  const [procedureId, setProcedureId] = useState('')
  const [amount, setAmount] = useState('')
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10))
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Dropdown só abre ao focar/digitar e fecha ao selecionar ou clicar fora —
  // antes ficava sempre aberto, sobrepondo os campos de valor/data/motivo.
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownContainerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!dropdownOpen) return
    function onDocPointerDown(e: MouseEvent) {
      const container = dropdownContainerRef.current
      if (!container) return
      if (!container.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setDropdownOpen(false)
    }
    document.addEventListener('mousedown', onDocPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [dropdownOpen])

  // Busca opera sobre TODOS os procedimentos cobertos. Os que já têm preço
  // neste convênio ficam visíveis (com badge "Já cadastrado") em vez de
  // sumirem — assim o usuário entende o estado e pode editar pela tabela.
  // Casamento de texto cobre: código (TUSS ou personalizado), display_name
  // customizado pela clínica E descrição do catálogo TUSS — sem o último,
  // procedimentos cadastrados sem display_name (cenário comum: usuário
  // selecionou o TUSS e não renomeou) ficariam "invisíveis" na busca por
  // nome.
  const filtered = search.trim().length === 0
    ? procedures.slice(0, 50)
    : procedures
        .filter((p) => {
          const q = search.toLowerCase()
          const codeMatch =
            typeof p.tussCode === 'string' &&
            p.tussCode.toLowerCase().includes(q)
          const nameMatch = (p.displayName ?? '').toLowerCase().includes(q)
          const catalogMatch =
            (p.catalogDescription ?? '').toLowerCase().includes(q)
          return codeMatch || nameMatch || catalogMatch
        })
        .slice(0, 50)

  // Estatísticas só do conjunto buscado — útil para diagnosticar
  // "por que meu procedimento não aparece pra adicionar?".
  const filteredAvailable = filtered.filter((p) => !pricedProcedureIds.has(p.id))
  const filteredAlreadyPriced = filtered.length - filteredAvailable.length

  const selectedProcedure = procedures.find((p) => p.id === procedureId) ?? null
  const selectedAlreadyPriced =
    selectedProcedure !== null && pricedProcedureIds.has(selectedProcedure.id)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!procedureId) {
      setError('Selecione o procedimento.')
      return
    }
    if (selectedAlreadyPriced) {
      setError(
        'Este procedimento já tem preço neste convênio. Use "Alterar valor" na tabela.',
      )
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
          displayName:
            selectedProcedure.displayName ??
            selectedProcedure.catalogDescription ??
            null,
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
        <div ref={dropdownContainerRef} className="relative">
          <Input
            id="add_search"
            placeholder="Buscar por TUSS ou nome…"
            value={search}
            onFocus={() => setDropdownOpen(true)}
            onChange={(e) => {
              setSearch(e.target.value)
              setDropdownOpen(true)
            }}
            autoComplete="off"
          />
          {dropdownOpen ? (
            <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-md border border-slate-200 bg-white text-xs shadow-lg">
              {filtered.length === 0 ? (
                <p className="px-3 py-2 text-slate-500">
                  Nenhum procedimento corresponde à busca{' '}
                  <span className="font-semibold">&quot;{search.trim()}&quot;</span>. Lista
                  limitada a procedimentos com{' '}
                  <span className="font-semibold">Coberto pelo plano de saúde</span>{' '}
                  marcado em{' '}
                  <Link href="/configuracoes/procedimentos" className="underline">
                    Configurações → Procedimentos
                  </Link>
                  .
                </p>
              ) : (
                filtered.map((p) => {
                  const alreadyPriced = pricedProcedureIds.has(p.id)
                  return (
                    <button
                      type="button"
                      key={p.id}
                      onClick={() => {
                        setProcedureId(p.id)
                        setSearch(
                          p.displayName ?? p.catalogDescription ?? p.tussCode,
                        )
                        setDropdownOpen(false)
                      }}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-slate-50',
                        p.id === procedureId
                          ? 'bg-slate-50 font-bold text-primary'
                          : 'text-slate-600',
                      )}
                    >
                      <span className="truncate">
                        {p.displayName ?? p.catalogDescription ?? '(sem nome)'}
                      </span>
                      <span className="ml-2 flex items-center gap-1.5">
                        {alreadyPriced ? (
                          <span className="rounded border border-success/30 bg-success-bg px-1 py-0.5 text-[9px] font-bold uppercase tracking-widest text-success-text">
                            Já cadastrado
                          </span>
                        ) : null}
                        {p.isCustomCoded ? (
                          <span className="rounded border border-violet-200 bg-violet-50 px-1 py-0.5 text-[9px] font-bold uppercase tracking-widest text-violet-700">
                            Pers.
                          </span>
                        ) : p.isUnlisted ? (
                          <span className="rounded border border-warning/30 bg-[hsl(var(--warning)/0.1)] px-1 py-0.5 text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--warning-foreground))]">
                            Não list.
                          </span>
                        ) : null}
                        <span className="font-mono text-[10px] text-slate-500">
                          {p.tussCode}
                        </span>
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          ) : null}
        </div>
        {search.trim().length > 0 && filteredAlreadyPriced > 0 && dropdownOpen ? (
          <p className="text-[11px] text-success-strong">
            {filteredAvailable.length} disponíve{filteredAvailable.length === 1 ? 'l' : 'is'}{' '}
            para adicionar · {filteredAlreadyPriced} já cadastrado
            {filteredAlreadyPriced === 1 ? '' : 's'} neste convênio.
          </p>
        ) : null}
        {selectedProcedure && !dropdownOpen ? (
          <p className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] text-slate-600">
            Selecionado:{' '}
            <span className="font-semibold text-slate-900">
              {selectedProcedure.displayName ??
                selectedProcedure.catalogDescription ??
                '(sem nome)'}
            </span>{' '}
            <span className="font-mono text-slate-500">({selectedProcedure.tussCode})</span>
          </p>
        ) : null}
        {selectedAlreadyPriced ? (
          <p className="rounded-md border border-warning/30 bg-[hsl(var(--warning)/0.1)] px-3 py-2 text-[11px] font-semibold text-[hsl(var(--warning-foreground))]">
            Este procedimento já tem preço cadastrado neste convênio. Para mudar o
            valor, use o botão &quot;Alterar valor&quot; na tabela abaixo.
          </p>
        ) : null}
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
        <div className="md:col-span-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
          {error}
        </div>
      ) : null}

      <div className="md:col-span-2 flex justify-end">
        <Button
          type="submit"
          size="sm"
          disabled={pending || selectedAlreadyPriced}
          className="gap-2"
        >
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
        <div className="md:col-span-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
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
