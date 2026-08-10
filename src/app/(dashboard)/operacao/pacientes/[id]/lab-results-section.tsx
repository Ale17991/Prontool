'use client'

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Beaker, Loader2, Plus, Printer, TrendingUp, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MetricEvolutionChart } from '@/components/patient-portal/evolution-chart'
import { LAB_ANALYTES, LAB_GROUPS, labAnalyte } from '@/lib/core/labs/catalog'
import type { LabClass, LabPanelResult } from '@/lib/core/labs/classify'
import { cn } from '@/lib/utils'

/**
 * Feature 050 US1 — exames laboratoriais no prontuário.
 *
 * Os resultados moram no motor de medições (030), então esta seção é irmã de
 * `metabolic-metrics-section.tsx`. Append-only: não há editar nem excluir —
 * correção é um novo lançamento, e a tela diz isso.
 *
 * A classificação baixo/normal/alto vem do servidor já resolvida contra a faixa
 * do sexo/idade do paciente. Quando falta sexo ou idade no cadastro, a API
 * devolve os valores mesmo assim com `need` — informar aqui não bloqueia nada.
 */

interface Props {
  patientId: string
  canWrite: boolean
}

interface SeriesPoint {
  measuredAt: string
  value: number
}

interface Payload {
  patient: { ageYears: number; sex: 'M' | 'F'; state: string } | null
  panel: LabPanelResult | null
  series: Record<string, SeriesPoint[]>
  need?: { age: boolean; sex: boolean; blockedBySex: number }
}

const CLASS_STYLE: Record<LabClass, { label: string; className: string }> = {
  baixo: {
    label: 'Baixo',
    className: 'bg-info-bg text-info-text',
  },
  alto: {
    label: 'Alto',
    className: 'bg-[hsl(var(--alert)/0.15)] text-[hsl(var(--alert))]',
  },
  normal: {
    label: 'Normal',
    className: 'bg-success-bg text-success-text',
  },
  sem_referencia: {
    label: 'Sem referência',
    className: 'bg-slate-100 text-slate-500',
  },
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '')
}

function refLabel(refMin: number | null, refMax: number | null): string {
  if (refMin !== null && refMax !== null) return `${fmt(refMin)} – ${fmt(refMax)}`
  if (refMax !== null) return `até ${fmt(refMax)}`
  if (refMin !== null) return `a partir de ${fmt(refMin)}`
  return '—'
}

function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}

export function LabResultsSection({ patientId, canWrite }: Props) {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  // Sexo/idade informados na tela quando faltam no cadastro (não persistem).
  const [sexOverride, setSexOverride] = useState('')
  const [ageOverride, setAgeOverride] = useState('')

  const load = useCallback(async () => {
    const qs = new URLSearchParams()
    if (sexOverride) qs.set('sex', sexOverride)
    if (ageOverride) qs.set('age', ageOverride)
    const suffix = qs.toString() ? `?${qs.toString()}` : ''
    const res = await fetch(`/api/pacientes/${patientId}/exames${suffix}`)
    if (res.ok) setData((await res.json()) as Payload)
    setLoading(false)
  }, [patientId, sexOverride, ageOverride])

  useEffect(() => {
    void load()
  }, [load])

  const grouped = useMemo(() => {
    const items = data?.panel?.items ?? []
    const byGroup = new Map<string, typeof items>()
    for (const it of items) {
      const list = byGroup.get(it.group) ?? []
      list.push(it)
      byGroup.set(it.group, list)
    }
    // Alterados primeiro dentro do painel; painéis na ordem do catálogo.
    return [...byGroup.entries()].sort(
      (a, b) => LAB_GROUPS.indexOf(a[0]) - LAB_GROUPS.indexOf(b[0]),
    )
  }, [data])

  // Sem classificação (faltou sexo/idade): mostra os valores crus da série.
  const rawLatest = useMemo(() => {
    if (data?.panel) return []
    return Object.entries(data?.series ?? {}).map(([key, pts]) => {
      const last = pts[pts.length - 1]!
      const def = labAnalyte(key)
      return { key, label: def?.label ?? key, unit: def?.unit ?? '', ...last }
    })
  }, [data])

  const hasAny = (data?.panel?.items.length ?? 0) > 0 || rawLatest.length > 0

  // Mesmos parâmetros que a leitura da tela usa — o impresso precisa sair com
  // a classificação que está sendo vista, não com outra.
  const pdfQuery = useMemo(() => {
    const qs = new URLSearchParams()
    if (sexOverride) qs.set('sex', sexOverride)
    if (ageOverride) qs.set('age', ageOverride)
    return qs.toString() ? `?${qs.toString()}` : ''
  }, [sexOverride, ageOverride])

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Beaker className="h-4 w-4 text-primary" />
          Exames laboratoriais
          {data?.panel && data.panel.low + data.panel.high > 0 ? (
            <span className="rounded-full bg-[hsl(var(--alert)/0.15)] px-2 py-0.5 text-[10px] font-bold text-[hsl(var(--alert))]">
              {data.panel.low + data.panel.high} alterado
              {data.panel.low + data.panel.high > 1 ? 's' : ''}
            </span>
          ) : null}
        </CardTitle>
        <div className="flex items-center gap-2">
          {/*
            Feature 054 US4 — o impresso carrega o sexo/idade informados aqui na
            tela. Sem eles na URL, o PDF classificaria menos exames que a tela
            está mostrando neste momento, e o papel contradiria a origem.
          */}
          {(data?.panel?.items.length ?? 0) > 0 ? (
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" asChild>
              <a href={`/api/pacientes/${patientId}/exames/pdf${pdfQuery}`} target="_blank" rel="noreferrer">
                <Printer className="h-3.5 w-3.5" /> PDF
              </a>
            </Button>
          ) : null}
          {canWrite ? (
            <Button
              size="sm"
              variant={showForm ? 'outline' : 'default'}
              onClick={() => setShowForm((v) => !v)}
              className="gap-1.5"
            >
              {showForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              {showForm ? 'Cancelar' : 'Lançar laudo'}
            </Button>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Só pede o sexo quando ele REALMENTE muda alguma coisa: a maioria das
            faixas é igual para ambos e já foi aplicada. */}
        {data?.need?.sex && (data.need.blockedBySex ?? 0) > 0 ? (
          <div className="rounded-md border border-[hsl(var(--warning)/0.4)] bg-[hsl(var(--warning)/0.08)] p-3">
            <p className="text-xs text-slate-700">
              <strong>
                {data.need.blockedBySex} exame{data.need.blockedBySex > 1 ? 's' : ''}
              </strong>{' '}
              {data.need.blockedBySex > 1 ? 'têm' : 'tem'} faixa diferente para homem e mulher, e o
              sexo não está no cadastro deste paciente — {data.need.blockedBySex > 1 ? 'eles aparecem' : 'ele aparece'}{' '}
              como “sem referência”. Os demais já estão classificados. Informe abaixo para completar.
            </p>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              {data.need.sex ? (
                <div>
                  <Label htmlFor="lab-sex" className="text-[10px]">
                    Sexo
                  </Label>
                  <select
                    id="lab-sex"
                    value={sexOverride}
                    onChange={(e) => setSexOverride(e.target.value)}
                    className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm"
                  >
                    <option value="">—</option>
                    <option value="M">Masculino</option>
                    <option value="F">Feminino</option>
                  </select>
                </div>
              ) : null}
              <p className="pb-2 text-[10px] text-slate-500">
                Vale só para esta consulta — para valer sempre, preencha o sexo no cadastro do
                paciente.
              </p>
            </div>
          </div>
        ) : null}

        {showForm && canWrite ? (
          <NewLabReportForm
            patientId={patientId}
            onCreated={async () => {
              setShowForm(false)
              await load()
            }}
          />
        ) : null}

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando exames…
          </p>
        ) : !hasAny ? (
          <p className="text-sm text-slate-500">Nenhum exame laboratorial registrado ainda.</p>
        ) : data?.panel ? (
          <div className="space-y-4">
            {grouped.map(([group, items]) => (
              <div key={group}>
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  {group}
                </p>
                <div className="overflow-hidden rounded-md border border-slate-200">
                  {items.map((it) => {
                    const style = CLASS_STYLE[it.class]
                    const isOpen = expanded === it.analyteKey
                    const points = data.series[it.analyteKey] ?? []
                    return (
                      <div key={it.analyteKey} className="border-b border-slate-100 last:border-0">
                        <button
                          type="button"
                          onClick={() => setExpanded(isOpen ? null : it.analyteKey)}
                          className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50"
                        >
                          <span className="min-w-0 flex-1 truncate text-sm text-slate-800">
                            {it.label}
                          </span>
                          <span className="tabular-nums text-sm font-bold text-slate-900">
                            {fmt(it.value)}{' '}
                            <span className="text-[10px] font-normal text-slate-500">{it.unit}</span>
                          </span>
                          <span className="hidden w-32 text-right text-[11px] tabular-nums text-slate-500 sm:inline">
                            {refLabel(it.refMin, it.refMax)}
                          </span>
                          <span
                            className={cn(
                              'rounded-full px-2 py-0.5 text-[10px] font-bold',
                              style.className,
                            )}
                          >
                            {style.label}
                          </span>
                          <span className="hidden w-20 text-right text-[11px] text-slate-400 md:inline">
                            {formatDate(it.measuredAt)}
                          </span>
                          {points.length > 1 ? (
                            <TrendingUp className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                          ) : (
                            <span className="w-3.5" />
                          )}
                        </button>
                        {isOpen ? (
                          <div className="border-t border-slate-100 bg-slate-50/60 p-3">
                            <MetricEvolutionChart
                              label={it.label}
                              unit={it.unit}
                              points={points.map((p) => ({ date: p.measuredAt, value: p.value }))}
                              refMin={it.refMin}
                              refMax={it.refMax}
                            />
                            {it.sourceLabel ? (
                              <p className="mt-1 text-[10px] text-slate-400">
                                Referência: {it.sourceLabel}
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-slate-200">
            {rawLatest.map((r) => (
              <div
                key={r.key}
                className="flex items-center gap-3 border-b border-slate-100 px-3 py-2 last:border-0"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{r.label}</span>
                <span className="tabular-nums text-sm font-bold text-slate-900">
                  {fmt(r.value)} <span className="text-[10px] font-normal text-slate-500">{r.unit}</span>
                </span>
                <span className="text-[11px] text-slate-400">{formatDate(r.measuredAt)}</span>
              </div>
            ))}
          </div>
        )}

        {hasAny ? (
          <p className="text-[10px] text-slate-400">
            Os resultados são um histórico permanente: não há editar nem excluir. Para corrigir um
            valor, lance o exame novamente — o registro anterior fica preservado.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

/** Formulário de laudo: uma data, N analitos, gravação atômica. */
function NewLabReportForm({
  patientId,
  onCreated,
}: {
  patientId: string
  onCreated: () => Promise<void>
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [measuredAt, setMeasuredAt] = useState(today)
  const [notes, setNotes] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim()
    const base = LAB_ANALYTES.filter((a) => values[a.key] === undefined)
    if (!q) return base.slice(0, 12)
    return base
      .filter((a) =>
        a.label
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .toLowerCase()
          .includes(q),
      )
      .slice(0, 12)
  }, [query, values])

  const chosen = Object.keys(values)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const results = chosen
      .map((key) => ({ analyte_key: key, value: Number(values[key]) }))
      .filter((r) => Number.isFinite(r.value))
    if (results.length === 0) {
      setError('Informe ao menos um resultado.')
      return
    }
    setSaving(true)
    const res = await fetch(`/api/pacientes/${patientId}/exames`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ measured_at: measuredAt, notes: notes || null, results }),
    })
    setSaving(false)
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
      setError(body?.error?.message ?? 'Não foi possível salvar o laudo.')
      return
    }
    setValues({})
    setNotes('')
    await onCreated()
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-md border border-slate-200 bg-slate-50/60 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="lab-date" className="text-[10px]">
            Data do exame
          </Label>
          <Input
            id="lab-date"
            type="date"
            value={measuredAt}
            max={today}
            onChange={(e) => setMeasuredAt(e.target.value)}
            className="h-9 w-40"
            required
          />
        </div>
        <div className="min-w-[12rem] flex-1">
          <Label htmlFor="lab-notes" className="text-[10px]">
            Observação (laboratório, método…)
          </Label>
          <Input
            id="lab-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={300}
            className="h-9"
          />
        </div>
      </div>

      {chosen.length > 0 ? (
        <div className="space-y-1.5">
          {chosen.map((key) => {
            const def = labAnalyte(key)
            return (
              <div key={key} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
                  {def?.label ?? key}
                </span>
                <Input
                  type="number"
                  step="any"
                  inputMode="decimal"
                  value={values[key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                  className="h-9 w-28"
                  autoFocus
                />
                <span className="w-16 text-[11px] text-slate-500">{def?.unit}</span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() =>
                    setValues((v) => {
                      const next = { ...v }
                      delete next[key]
                      return next
                    })
                  }
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            )
          })}
        </div>
      ) : null}

      <div>
        <Label htmlFor="lab-search" className="text-[10px]">
          Adicionar exame
        </Label>
        <Input
          id="lab-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar (ferritina, TSH, hemoglobina…)"
          className="h-9"
        />
        {filtered.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {filtered.map((a) => (
              <button
                key={a.key}
                type="button"
                onClick={() => {
                  setValues((v) => ({ ...v, [a.key]: '' }))
                  setQuery('')
                }}
                className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-700 hover:border-primary hover:text-primary"
              >
                {a.label}
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-1.5 text-[11px] text-slate-400">Nenhum exame encontrado.</p>
        )}
      </div>

      {error ? <p className="text-xs text-[hsl(var(--alert))]">{error}</p> : null}

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={saving || chosen.length === 0}>
          {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
          Salvar laudo
        </Button>
        <p className="text-[10px] text-slate-400">
          Todos os resultados são gravados juntos — se um valor for recusado, nenhum entra.
        </p>
      </div>
    </form>
  )
}
