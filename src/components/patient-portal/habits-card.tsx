'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Flame, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Grade de hábitos no portal — a ÚNICA parte do portal em que o paciente
 * escreve.
 *
 * Marcação é binária e só o positivo é registrado: o branco fica ambíguo de
 * propósito, porque não dá para distinguir "não fiz" de "não abri o app". Por
 * isso a tela nunca mostra percentual de aderência nem pinta o vazio de
 * vermelho — cobrar a pessoa por um dado que o sistema não tem seria mentira,
 * além de desestimular quem esqueceu de marcar.
 */

interface HabitItem {
  id: string
  label: string
}
interface Mark {
  itemId: string
  markDate: string
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
  checklist: { id: string; title: string; items: HabitItem[]; periodKind: string }
  period: { startDate: string; endDate: string; days: string[] }
  marks: Mark[]
  stats: ItemStat[]
}

const WEEKDAY = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

/** Rótulo curto do dia sem passar por `Date` local (evita escorregar de fuso). */
function dayLabel(iso: string): { day: string; wd: string } {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return { day: String(d).padStart(2, '0'), wd: WEEKDAY[wd]! }
}

export function HabitsCard({ today }: { today: string }) {
  const [grid, setGrid] = useState<Grid | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/paciente/habitos')
      if (res.ok) setGrid(((await res.json()) as { grid: Grid | null }).grid)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function toggle(itemId: string, markDate: string, marked: boolean) {
    const key = `${itemId}|${markDate}`
    setBusy(key)
    setError(null)
    try {
      const res = await fetch('/api/paciente/habitos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ itemId, markDate, marked }),
      })
      if (!res.ok) {
        const e = (await res.json().catch(() => null)) as { error?: { code?: string } } | null
        setError(
          e?.error?.code === 'DATE_OUT_OF_PERIOD'
            ? 'Esse dia não faz parte do período atual.'
            : 'Não consegui salvar. Tente de novo.',
        )
        return
      }
      // A grade vem do servidor: a tela reflete o que foi gravado de verdade,
      // em vez de um otimismo local que mentiria se a gravação falhasse.
      setGrid(((await res.json()) as { grid: Grid | null }).grid)
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando seus hábitos…
        </CardContent>
      </Card>
    )
  }
  if (!grid || grid.checklist.items.length === 0) return null

  const marked = new Set(grid.marks.map((m) => `${m.itemId}|${m.markDate}`))
  const statOf = (id: string) => grid.stats.find((s) => s.itemId === id)

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{grid.checklist.title}</CardTitle>
        <p className="text-xs text-slate-500">
          Marque o que você cumpriu. Pode preencher dias anteriores deste período.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-separate border-spacing-0 text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-white p-1 text-left font-medium text-slate-400">
                  &nbsp;
                </th>
                {grid.period.days.map((d) => {
                  const { day, wd } = dayLabel(d)
                  const isToday = d === today
                  return (
                    <th
                      key={d}
                      className={`p-1 text-center font-medium ${isToday ? 'text-primary' : 'text-slate-400'}`}
                    >
                      <div className="text-[10px] uppercase">{wd}</div>
                      <div className={isToday ? 'font-bold' : ''}>{day}</div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {grid.checklist.items.map((item) => {
                const st = statOf(item.id)
                return (
                  <tr key={item.id}>
                    <td className="sticky left-0 z-10 max-w-[180px] bg-white py-1 pr-2">
                      <div className="truncate font-medium text-slate-700" title={item.label}>
                        {item.label}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-slate-400">
                        <span>
                          {st?.markedDays ?? 0} de {st?.elapsedDays ?? 0} dias
                        </span>
                        {st && st.currentStreak > 1 ? (
                          <span className="inline-flex items-center gap-0.5 text-amber-600">
                            <Flame className="h-3 w-3" />
                            {st.currentStreak}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    {grid.period.days.map((d) => {
                      const key = `${item.id}|${d}`
                      const on = marked.has(key)
                      // Dia futuro não é marcável: não se cumpre hábito amanhã.
                      const future = d > today
                      return (
                        <td key={d} className="p-0.5 text-center">
                          <button
                            type="button"
                            disabled={future || busy === key}
                            onClick={() => void toggle(item.id, d, !on)}
                            aria-label={`${item.label} em ${d}`}
                            aria-pressed={on}
                            className={`inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors ${
                              on
                                ? 'border-emerald-500 bg-emerald-500 text-white'
                                : future
                                  ? 'cursor-not-allowed border-slate-100 bg-slate-50'
                                  : 'border-slate-200 bg-white hover:border-emerald-400 hover:bg-emerald-50'
                            }`}
                          >
                            {busy === key ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : on ? (
                              <Check className="h-4 w-4" />
                            ) : null}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {error ? <p className="text-xs text-red-600">{error}</p> : null}
        <p className="text-[10px] text-slate-400">
          Período de {grid.period.startDate.split('-').reverse().join('/')} a{' '}
          {grid.period.endDate.split('-').reverse().join('/')}. Ao terminar, a grade recomeça
          sozinha.
        </p>
      </CardContent>
    </Card>
  )
}
