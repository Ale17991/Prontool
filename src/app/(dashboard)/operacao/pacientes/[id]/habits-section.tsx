'use client'

import { useCallback, useEffect, useState } from 'react'
import { CalendarCheck, Check, Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { READY_MADE_CHECKLISTS } from '@/lib/core/habits/ready-made'

/**
 * Checklist de hábitos no prontuário — a equipe MONTA a grade; quem marca é o
 * paciente, pelo portal. Por isso aqui não existe nenhum controle de marcação:
 * só a montagem e a leitura do que ele registrou.
 */

interface HabitItem {
  id: string
  label: string
}
interface ItemStat {
  itemId: string
  label: string
  markedDays: number
  elapsedDays: number
  longestStreak: number
  currentStreak: number
}
interface Grid {
  checklist: { id: string; title: string; periodKind: string; startDate: string; items: HabitItem[] }
  period: { startDate: string; endDate: string; days: string[] }
  stats: ItemStat[]
}
interface PeriodSummary {
  periodIndex: number
  startDate: string
  endDate: string
  stats: ItemStat[]
}
interface Template {
  id: string
  title: string
  items: HabitItem[]
  active: boolean
}

const PERIOD_LABEL: Record<string, string> = {
  semanal: 'Semanal',
  quinzenal: 'Quinzenal',
  mensal: 'Mensal',
}

const br = (iso: string) => iso.split('-').reverse().join('/')

let seq = 0
const newItemId = () => `h${Date.now().toString(36)}${(seq++).toString(36)}`

export function HabitsSection({ patientId, canWrite }: { patientId: string; canWrite: boolean }) {
  const [grid, setGrid] = useState<Grid | null>(null)
  const [history, setHistory] = useState<PeriodSummary[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const [title, setTitle] = useState('Meus hábitos')
  const [periodKind, setPeriodKind] = useState('semanal')
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [items, setItems] = useState<HabitItem[]>([])

  const load = useCallback(async () => {
    try {
      const [g, t] = await Promise.all([
        fetch(`/api/pacientes/${patientId}/habitos`),
        fetch('/api/habitos/modelos'),
      ])
      if (g.ok) {
        const data = (await g.json()) as { grid: Grid | null; history: PeriodSummary[] }
        setGrid(data.grid)
        setHistory(data.history ?? [])
        if (data.grid) {
          setTitle(data.grid.checklist.title)
          setPeriodKind(data.grid.checklist.periodKind)
          setStartDate(data.grid.checklist.startDate)
          setItems(data.grid.checklist.items)
        }
      }
      if (t.ok) setTemplates(((await t.json()) as { templates: Template[] }).templates ?? [])
    } finally {
      setLoading(false)
    }
  }, [patientId])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * Aplicar um modelo COPIA os itens para a edição do paciente. Daqui em diante
   * a grade dele tem vida própria — remover um hábito aqui não mexe na lista
   * base da clínica.
   */
  function applyTemplate(t: Template) {
    setTitle(t.title)
    setItems(t.items.map((i) => ({ ...i })))
    setEditing(true)
  }

  async function save() {
    if (items.length === 0) {
      setMsg('Adicione ao menos um hábito.')
      return
    }
    setSaving(true)
    setMsg(null)
    try {
      const res = await fetch(`/api/pacientes/${patientId}/habitos`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: grid?.checklist.id ?? null,
          title,
          periodKind,
          startDate,
          items,
        }),
      })
      if (!res.ok) {
        setMsg('Não foi possível salvar.')
        return
      }
      setEditing(false)
      await load()
      setMsg('Checklist salvo. O paciente já vê no portal.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando hábitos…
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-2">
        <CalendarCheck className="h-4 w-4 text-primary" />
        <CardTitle className="text-sm">Checklist de hábitos</CardTitle>
        {canWrite ? (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? 'Cancelar' : grid ? 'Editar grade' : 'Montar grade'}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {!grid && !editing ? (
          <p className="text-xs text-slate-400">
            Nenhum checklist ativo. Monte a grade e o paciente passa a marcar pelo portal.
          </p>
        ) : null}

        {editing ? (
          <div className="space-y-3 rounded-md border border-slate-200 p-3">
            <div>
              <Label className="text-xs">Partir de um modelo pronto</Label>
              <div className="mt-1 flex flex-wrap gap-1">
                {READY_MADE_CHECKLISTS.map((m) => (
                  <Button
                    key={m.slug}
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    title={m.hint}
                    onClick={() => {
                      // Cópia: a partir daqui a grade é DESTE paciente. Editar
                      // aqui não mexe no catálogo nem em outro paciente.
                      setTitle(m.title)
                      setItems(m.items.map((i) => ({ ...i })))
                    }}
                  >
                    {m.title}
                  </Button>
                ))}
              </div>
              <p className="mt-1 text-[10px] text-slate-400">
                Os hábitos abrem para edição. Acrescente, remova ou reescreva antes de salvar.
              </p>
            </div>

            {templates.length > 0 ? (
              <div>
                <Label className="text-xs">Partir de um modelo da clínica</Label>
                <div className="mt-1 flex flex-wrap gap-1">
                  {templates
                    .filter((t) => t.active)
                    .map((t) => (
                      <Button
                        key={t.id}
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => applyTemplate(t)}
                      >
                        {t.title}
                      </Button>
                    ))}
                </div>
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-3">
              <div className="md:col-span-1">
                <Label htmlFor="hb_title">Título</Label>
                <Input id="hb_title" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="hb_period">Período</Label>
                <select
                  id="hb_period"
                  className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                  value={periodKind}
                  onChange={(e) => setPeriodKind(e.target.value)}
                >
                  <option value="semanal">Semanal</option>
                  <option value="quinzenal">Quinzenal</option>
                  <option value="mensal">Mensal</option>
                </select>
              </div>
              <div>
                <Label htmlFor="hb_start">Começa em</Label>
                <Input
                  id="hb_start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Hábitos (perguntas curtas de sim ou não)</Label>
              {items.map((it, idx) => (
                <div key={it.id} className="flex items-center gap-2">
                  <Input
                    className="h-8 text-sm"
                    value={it.label}
                    placeholder="Bateu a meta de água hoje?"
                    onChange={(e) =>
                      setItems((v) =>
                        v.map((x, i) => (i === idx ? { ...x, label: e.target.value } : x)),
                      )
                    }
                  />
                  <button
                    type="button"
                    onClick={() => setItems((v) => v.filter((_, i) => i !== idx))}
                    className="text-slate-300 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => setItems((v) => [...v, { id: newItemId(), label: '' }])}
              >
                <Plus className="h-3 w-3" /> Adicionar hábito
              </Button>
            </div>

            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Salvar checklist
            </Button>
            <p className="text-[10px] text-slate-400">
              Alterar aqui muda só a grade deste paciente. O modelo da clínica fica intacto.
            </p>
          </div>
        ) : null}

        {grid && !editing ? (
          <div className="space-y-2">
            <p className="text-xs text-slate-500">
              {PERIOD_LABEL[grid.checklist.periodKind] ?? grid.checklist.periodKind} ·{' '}
              {br(grid.period.startDate)} a {br(grid.period.endDate)}
            </p>
            <div className="space-y-1">
              {grid.stats.map((s) => (
                <div
                  key={s.itemId}
                  className="flex items-center gap-2 rounded-md bg-slate-50 px-2 py-1.5 text-xs"
                >
                  <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  <span className="flex-1 truncate">{s.label}</span>
                  <span className="shrink-0 tabular-nums text-slate-500">
                    marcou {s.markedDays} de {s.elapsedDays} dias
                  </span>
                  {s.longestStreak > 1 ? (
                    <span className="shrink-0 text-[10px] text-amber-600">
                      seq. {s.longestStreak}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
            {/*
              Não existe percentual de aderência: a marcação é binária e o branco
              é ambíguo — não distingue "não fez" de "não abriu o app". Dizer
              "60% de aderência" seria inventar precisão sobre o silêncio.
            */}
            <p className="text-[10px] text-slate-400">
              Dias em branco não significam que o hábito não foi cumprido, só que não foi marcado.
            </p>

            {history.length > 0 ? (
              <details className="pt-1">
                <summary className="cursor-pointer text-xs font-medium text-slate-500">
                  Períodos anteriores ({history.length})
                </summary>
                <div className="mt-2 space-y-2">
                  {history.map((h) => (
                    <div key={h.periodIndex} className="rounded-md border border-slate-100 p-2">
                      <p className="text-[11px] font-medium text-slate-500">
                        {br(h.startDate)} a {br(h.endDate)}
                      </p>
                      {h.stats.map((s) => (
                        <div key={s.itemId} className="flex justify-between text-[11px]">
                          <span className="truncate text-slate-600">{s.label}</span>
                          <span className="tabular-nums text-slate-400">
                            {s.markedDays}/{s.elapsedDays}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        ) : null}

        {msg ? <p className="text-xs text-slate-500">{msg}</p> : null}
      </CardContent>
    </Card>
  )
}
